// backend/routes/api-keys.js
// Gestion des cles API (creees depuis l'interface web)

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { SCOPES, generateApiKey } = require('../utils/api/auth');

const router = express.Router();

// ============================================================
// GET /api/api-keys — Liste des cles de l'utilisateur
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, key_prefix, scopes, rate_limit_per_hour,
                   last_used_at, expires_at, active, created_at, revoked_at
            FROM api_keys
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(k => ({
            id: k.id,
            name: k.name,
            prefix: k.key_prefix,
            scopes: k.scopes || [],
            rateLimit: k.rate_limit_per_hour,
            lastUsedAt: k.last_used_at,
            expiresAt: k.expires_at,
            active: k.active,
            createdAt: k.created_at,
            revokedAt: k.revoked_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/api-keys/scopes — Liste des scopes disponibles
// ============================================================
router.get('/scopes', authenticateToken, (req, res) => {
    res.json(Object.entries(SCOPES).map(([key, label]) => ({ key, label })));
});

// ============================================================
// POST /api/api-keys — Creer une nouvelle cle
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { name, scopes, rateLimit, expiresAt } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom est requis.' });
    }

    const validScopes = ['read', 'write', 'admin'];
    const finalScopes = Array.isArray(scopes) && scopes.length > 0
        ? scopes.filter(s => validScopes.includes(s))
        : ['read'];

    if (finalScopes.length === 0) {
        return res.status(400).json({ error: 'Au moins un scope valide est requis.' });
    }

    try {
        const generated = generateApiKey();

        const result = await pool.query(`
            INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, name, key_prefix, scopes, rate_limit_per_hour, expires_at, created_at
        `, [
            req.user.id,
            name.trim(),
            generated.prefix,
            generated.hash,
            JSON.stringify(finalScopes),
            parseInt(rateLimit) || 1000,
            expiresAt || null
        ]);

        res.json({
            success: true,
            apiKey: {
                id: result.rows[0].id,
                name: result.rows[0].name,
                prefix: result.rows[0].key_prefix,
                scopes: result.rows[0].scopes,
                rateLimit: result.rows[0].rate_limit_per_hour,
                expiresAt: result.rows[0].expires_at,
                createdAt: result.rows[0].created_at
            },
            secretKey: generated.fullKey,
            warning: 'Copiez cette cle maintenant. Elle ne sera plus jamais affichee.'
        });
    } catch (err) {
        console.error('Erreur create api key:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/api-keys/:id — Modifier une cle
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { name, scopes, rateLimit, active } = req.body;

    try {
        const result = await pool.query(`
            UPDATE api_keys SET
                name = COALESCE($1, name),
                scopes = COALESCE($2, scopes),
                rate_limit_per_hour = COALESCE($3, rate_limit_per_hour),
                active = COALESCE($4, active)
            WHERE id = $5 AND user_id = $6
            RETURNING id, name, key_prefix, scopes, rate_limit_per_hour, active
        `, [
            name || null,
            Array.isArray(scopes) && scopes.length > 0 ? JSON.stringify(scopes) : null,
            rateLimit !== undefined ? parseInt(rateLimit) : null,
            active !== undefined ? active : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cle introuvable.' });
        }

        res.json({ success: true, apiKey: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/api-keys/:id/revoke — Revoquer une cle
// ============================================================
router.post('/:id/revoke', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE api_keys SET active = FALSE, revoked_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [id, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cle introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/api-keys/:id — Supprimer definitivement
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cle introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/api-keys/logs — Historique des appels
// ============================================================
router.get('/logs', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const result = await pool.query(`
            SELECT l.*, k.name as key_name, k.key_prefix
            FROM api_logs l
            LEFT JOIN api_keys k ON k.id = l.api_key_id
            WHERE l.user_id = $1
            ORDER BY l.created_at DESC
            LIMIT $2
        `, [req.user.id, limit]);

        res.json(result.rows.map(l => ({
            id: l.id,
            keyName: l.key_name,
            keyPrefix: l.key_prefix,
            method: l.method,
            endpoint: l.endpoint,
            statusCode: l.status_code,
            ipAddress: l.ip_address,
            durationMs: l.duration_ms,
            errorMessage: l.error_message,
            createdAt: l.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/api-keys/stats — Statistiques d'usage
// ============================================================
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const [todayResult, weekResult, topResult] = await Promise.all([
            pool.query(`
                SELECT COUNT(*) as count,
                       COUNT(*) FILTER (WHERE status_code >= 400) as errors
                FROM api_logs
                WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
            `, [req.user.id]),
            pool.query(`
                SELECT COUNT(*) as count
                FROM api_logs
                WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
            `, [req.user.id]),
            pool.query(`
                SELECT endpoint, COUNT(*) as count
                FROM api_logs
                WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
                GROUP BY endpoint
                ORDER BY count DESC
                LIMIT 5
            `, [req.user.id])
        ]);

        res.json({
            last24h: {
                calls: parseInt(todayResult.rows[0].count),
                errors: parseInt(todayResult.rows[0].errors)
            },
            last7days: {
                calls: parseInt(weekResult.rows[0].count)
            },
            topEndpoints: topResult.rows.map(r => ({
                endpoint: r.endpoint,
                count: parseInt(r.count)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;