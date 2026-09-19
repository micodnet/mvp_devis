// Routes d'administration protégées par une clé secrète (ADMIN_BACKUP_KEY)

const express = require('express');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { runEmailSequence } = require('../utils/email-sequence');

const router = express.Router();

// Tables à sauvegarder (dans l'ordre logique pour la restauration)
const TABLES = [
    'users',
    'settings',
    'clients',
    'products',
    'quotes',
    'counters',
    'monthly_quota',
    'password_reset_tokens',
    'email_log',
    'invoices',
    'invoice_counters'
];

// Middleware : vérifie la clé admin
function requireAdminKey(req, res, next) {
    const providedKey = req.headers['x-admin-key'] || req.query.key;
    const expectedKey = process.env.ADMIN_BACKUP_KEY;

    if (!expectedKey) {
        return res.status(500).json({ error: 'ADMIN_BACKUP_KEY non configurée sur le serveur.' });
    }
    if (!providedKey || providedKey !== expectedKey) {
        return res.status(403).json({ error: 'Clé admin invalide ou manquante.' });
    }
    next();
}

// ============================================================
// GET /api/admin/stats — Aperçu des tables (nb lignes, taille)
// ============================================================
router.get('/stats', requireAdminKey, async (req, res) => {
    try {
        const stats = {};
        for (const table of TABLES) {
            try {
                const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
                const sizeResult = await pool.query(
                    `SELECT pg_size_pretty(pg_total_relation_size($1)) as size`,
                    [table]
                );
                stats[table] = {
                    rows: parseInt(countResult.rows[0].count),
                    size: sizeResult.rows[0]?.size || '0 bytes'
                };
            } catch (err) {
                stats[table] = { error: err.message };
            }
        }
        res.json({
            generatedAt: new Date().toISOString(),
            database: 'Supabase PostgreSQL',
            tables: stats
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/admin/backup — Dump complet de la base en JSON
// ============================================================
router.get('/backup', requireAdminKey, async (req, res) => {
    try {
        const backup = {
            _meta: {
                generated_at: new Date().toISOString(),
                version: '1.0',
                source: 'devis-express-pro',
                tables: TABLES
            },
            data: {}
        };

        for (const table of TABLES) {
            try {
                const result = await pool.query(`SELECT * FROM ${table}`);
                backup.data[table] = result.rows;
            } catch (err) {
                backup.data[table] = { _error: err.message };
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `backup-devis-express-${timestamp}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(backup, null, 2));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/admin/backup/download — Simple redirection pour forcer le téléchargement
// (utile pour ouvrir depuis le navigateur avec ?key=xxx)
// ============================================================
router.get('/backup/download', requireAdminKey, (req, res) => {
    res.redirect(`/api/admin/backup?key=${encodeURIComponent(req.query.key)}`);
});

// ============================================================
// POST /api/admin/restore — Restaure une sauvegarde JSON
// ⚠️ ATTENTION : écrase toutes les données existantes
// ============================================================
router.post('/restore', requireAdminKey, express.json({ limit: '50mb' }), async (req, res) => {
    const { data, confirm } = req.body;

    if (confirm !== 'YES_RESTORE_ALL_DATA') {
        return res.status(400).json({
            error: 'Confirmation manquante. Envoyez { "confirm": "YES_RESTORE_ALL_DATA" } pour confirmer.'
        });
    }
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Données manquantes.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Désactiver les contraintes pendant la restauration
        await client.query('SET session_replication_role = replica');

        // Vider les tables (ordre inverse des dépendances)
        const reversedTables = [...TABLES].reverse();
        for (const table of reversedTables) {
            if (data[table] && Array.isArray(data[table])) {
                await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
            }
        }

        // Réinsérer les données
        const inserted = {};
        for (const table of TABLES) {
            const rows = data[table];
            if (!rows || !Array.isArray(rows) || rows.length === 0) {
                inserted[table] = 0;
                continue;
            }

            const columns = Object.keys(rows[0]);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const columnList = columns.map(c => `"${c}"`).join(', ');

            let count = 0;
            for (const row of rows) {
                const values = columns.map(c => row[c]);
                await client.query(
                    `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`,
                    values
                );
                count++;
            }
            inserted[table] = count;
        }

        // Remettre les séquences à jour
        for (const table of TABLES) {
            try {
                await client.query(`
                    SELECT setval(
                        pg_get_serial_sequence('${table}', 'id'),
                        COALESCE((SELECT MAX(id) FROM ${table}), 1),
                        (SELECT MAX(id) FROM ${table}) IS NOT NULL
                    )
                `);
            } catch (e) {
                // Certaines tables n'ont pas d'id auto-incrémenté, on ignore
            }
        }

        await client.query('SET session_replication_role = DEFAULT');
        await client.query('COMMIT');

        res.json({
            success: true,
            restored_at: new Date().toISOString(),
            inserted
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur restore:', err);
        res.status(500).json({ error: 'Erreur restauration : ' + err.message });
    } finally {
        client.release();
    }
});

// ============================================================
// Helper : escape une valeur pour INSERT SQL
// ============================================================
function escapeSqlValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) {
        return `'${value.toISOString().replace('T', ' ').slice(0, 19)}'`;
    }
    // JSONB ou objet : stringifier et cast
    if (typeof value === 'object') {
        const json = JSON.stringify(value).replace(/'/g, "''");
        return `'${json}'::jsonb`;
    }
    // String : échapper les apostrophes
    const str = String(value).replace(/'/g, "''");
    return `'${str}'`;
}

// ============================================================
// Helper : génère les INSERT pour une table
// ============================================================
function generateInserts(table, rows) {
    if (!rows || rows.length === 0) return `-- (aucune donnée dans ${table})\n`;

    const columns = Object.keys(rows[0]);
    const columnList = columns.map(c => `"${c}"`).join(', ');

    let sql = `-- Données de ${table} (${rows.length} lignes)\n`;
    for (const row of rows) {
        const values = columns.map(c => escapeSqlValue(row[c])).join(', ');
        sql += `INSERT INTO ${table} (${columnList}) VALUES (${values});\n`;
    }
    return sql + '\n';
}

// ============================================================
// Helper : reset les séquences après insertion
// ============================================================
function generateSequenceReset(table) {
    return `
SELECT setval(
    pg_get_serial_sequence('${table}', 'id'),
    COALESCE((SELECT MAX(id) FROM ${table}), 1),
    (SELECT MAX(id) FROM ${table}) IS NOT NULL
);
`;
}

// ============================================================
// GET /api/admin/backup-sql — Génère un dump SQL complet
// (schéma + données + reset des séquences)
// ============================================================
router.get('/backup-sql', requireAdminKey, async (req, res) => {
    try {
        const schemaPath = path.join(__dirname, '..', 'backups/schema.sql');
        if (!fs.existsSync(schemaPath)) {
            return res.status(500).json({ error: 'Fichier schema.sql introuvable. Crée-le dans backend/backups.' });
        }
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        let sql = `-- ============================================================\n`;
        sql += `-- BACKUP DEVIS EXPRESS PRO — ${new Date().toISOString()}\n`;
        sql += `-- ============================================================\n`;
        sql += `-- Ce fichier contient :\n`;
        sql += `--   1. Le schéma complet (CREATE TABLE)\n`;
        sql += `--   2. Les données (INSERT)\n`;
        sql += `--   3. Le reset des séquences\n`;
        sql += `--\n`;
        sql += `-- POUR RESTAURER :\n`;
        sql += `--   1. Crée un projet Supabase vide\n`;
        sql += `--   2. Ouvre SQL Editor → New query\n`;
        sql += `--   3. Colle CE FICHIER ENTIER et clique Run\n`;
        sql += `-- ============================================================\n\n`;

        // 1. DROP (pour repartir propre si la base existe déjà)
        sql += `-- ============================================================\n`;
        sql += `-- ÉTAPE 1 : DROP des tables existantes (idempotent)\n`;
        sql += `-- ============================================================\n`;
        const reversedTables = [...TABLES].reverse();
        for (const table of reversedTables) {
            sql += `DROP TABLE IF EXISTS ${table} CASCADE;\n`;
        }
        sql += `\n`;

        // 2. SCHEMA
        sql += `-- ============================================================\n`;
        sql += `-- ÉTAPE 2 : Création du schéma\n`;
        sql += `-- ============================================================\n`;
        sql += schemaSql + '\n\n';

        // 3. DATA
        sql += `-- ============================================================\n`;
        sql += `-- ÉTAPE 3 : Insertion des données\n`;
        sql += `-- ============================================================\n\n`;

        for (const table of TABLES) {
            try {
                const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
                sql += generateInserts(table, result.rows);
            } catch (err) {
                sql += `-- ⚠️ Erreur de lecture de ${table} : ${err.message}\n\n`;
            }
        }

        // 4. RESET DES SÉQUENCES
        sql += `-- ============================================================\n`;
        sql += `-- ÉTAPE 4 : Réinitialisation des séquences\n`;
        sql += `-- ============================================================\n`;
        const tablesWithSerial = ['users', 'clients', 'products', 'quotes', 'monthly_quota', 'password_reset_tokens'];
        for (const table of tablesWithSerial) {
            sql += generateSequenceReset(table);
        }

        sql += `\n-- ============================================================\n`;
        sql += `-- FIN DU BACKUP\n`;
        sql += `-- ============================================================\n`;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `backup-devis-express-${timestamp}.sql`;

        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(sql);
    } catch (err) {
        console.error('Erreur backup-sql:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/admin/schema-check — Vérifie que schema.sql est à jour
// ============================================================
router.get('/schema-check', requireAdminKey, async (req, res) => {
    try {
        // Récupérer les tables existantes
        const liveTables = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        const liveTablesList = liveTables.rows.map(r => r.table_name);

        // Récupérer les colonnes de chaque table
        const liveColumns = {};
        for (const table of liveTablesList) {
            const cols = await pool.query(`
                SELECT column_name, data_type FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            liveColumns[table] = cols.rows.map(c => `${c.column_name}:${c.data_type}`);
        }

        // Comparer avec la liste attendue dans schema.sql
        const expectedTables = [
            'users', 'settings', 'clients', 'products', 'quotes',
            'counters', 'monthly_quota', 'password_reset_tokens'
        ];

        const missingTables = expectedTables.filter(t => !liveTablesList.includes(t));
        const extraTables = liveTablesList.filter(t => !expectedTables.includes(t));

        res.json({
            live_tables: liveTablesList,
            expected_tables: expectedTables,
            missing_from_db: missingTables,
            extra_in_db: extraTables,
            columns: liveColumns,
            status: missingTables.length === 0 && extraTables.length === 0 ? 'OK' : 'INCOHÉRENT'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/admin/run-email-sequence — Lance la séquence d'emails
// (appelé par un cron quotidien)
// ============================================================
router.post('/run-email-sequence', requireAdminKey, async (req, res) => {
    try {
        const baseUrl = req.body.baseUrl || `${req.protocol}://${req.get('host')}`;
        console.log(`📧 Lancement de la séquence d'emails...`);
        const stats = await runEmailSequence(baseUrl);
        console.log(`📧 Séquence terminée : ${stats.sent} envoyés, ${stats.skipped} ignorés, ${stats.errors} erreurs`);
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            stats
        });
    } catch (err) {
        console.error('Erreur run-email-sequence:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/admin/email-log — Voir l'historique des envois
// ============================================================
router.get('/email-log', requireAdminKey, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT el.id, el.email_type, el.sent_at,
                   u.email, u.subscription_plan
            FROM email_log el
            JOIN users u ON u.id = el.user_id
            ORDER BY el.sent_at DESC
            LIMIT 200
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/admin/email-log/reset — Efface l'historique des emails
// (utilise pour re-tester la séquence)
// ============================================================
router.delete('/email-log/reset', requireAdminKey, async (req, res) => {
    try {
        const email = req.body?.email;
        if (email) {
            const result = await pool.query(`
                DELETE FROM email_log
                WHERE user_id = (SELECT id FROM users WHERE email = $1)
                RETURNING id
            `, [email]);
            res.json({ success: true, deleted: result.rows.length });
        } else {
            const result = await pool.query('DELETE FROM email_log RETURNING id');
            res.json({ success: true, deleted: result.rows.length });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;