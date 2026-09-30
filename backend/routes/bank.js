// backend/routes/bank.js
// Routes d'import bancaire et rapprochement

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseBankStatement } = require('../utils/bank/parser');
const { findMatches, autoMatchAll, validateMatch } = require('../utils/bank/matcher');

const router = express.Router();

// Configuration Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'bank');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.csv', '.ofx', '.qfx', '.xml', '.xlsx', '.xls'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Format non supporte. Utilisez CSV, OFX, XML ou XLSX.'));
    }
});

// ============================================================
// POST /api/bank/import — Importer un releve
// ============================================================
router.post('/import', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier envoye.' });
    }

    const filePath = req.file.path;
    let importId = null;

    try {
        // Parser le fichier
        const result = parseBankStatement(filePath, req.file.originalname, req.file.mimetype);

        if (result.transactions.length === 0) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Aucune transaction trouvee dans ce fichier.' });
        }

        // Creer l'entree d'import
        const importResult = await pool.query(`
            INSERT INTO bank_imports (
                user_id, filename, original_name, format, transactions_count
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [
            req.user.id,
            req.file.filename,
            req.file.originalname,
            result.format,
            result.transactions.length
        ]);

        importId = importResult.rows[0].id;

        // Inserer les transactions
        for (const tx of result.transactions) {
            await pool.query(`
                INSERT INTO bank_transactions (
                    user_id, import_id, transaction_date, value_date,
                    amount, currency, description, counterparty, reference, transaction_type
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                req.user.id,
                importId,
                tx.date,
                tx.valueDate || null,
                tx.amount,
                tx.currency || 'EUR',
                tx.description,
                tx.counterparty,
                tx.reference,
                tx.transactionType
            ]);
        }

        // Nettoyer le fichier
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Lancer le matching automatique
        const matchResult = await autoMatchAll(req.user.id);

        // Mettre a jour le compteur d'import
        await pool.query(
            'UPDATE bank_imports SET reconciled_count = $1 WHERE id = $2',
            [matchResult.matched, importId]
        );

        res.json({
            success: true,
            importId: importId,
            transactionsCount: result.transactions.length,
            format: result.format,
            matched: matchResult.matched,
            highConfidence: matchResult.highConfidence
        });
    } catch (err) {
        console.error('Erreur import bancaire:', err);

        // Logger l'erreur
        if (importId) {
            await pool.query(
                'UPDATE bank_imports SET error_message = $1 WHERE id = $2',
                [err.message, importId]
            ).catch(() => {});
        }

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/bank/imports — Historique des imports
// ============================================================
router.get('/imports', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM bank_imports
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);

        res.json(result.rows.map(i => ({
            id: i.id,
            originalName: i.original_name,
            format: i.format,
            transactionsCount: i.transactions_count,
            reconciledCount: i.reconciled_count,
            errorMessage: i.error_message,
            createdAt: i.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/bank/transactions — Liste des transactions
// ============================================================
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const { status, type, from, to } = req.query;

        let query = `
            SELECT t.*,
                   i.invoice_number as invoice_number,
                   i.client_name as invoice_client_name,
                   i.total as invoice_total
            FROM bank_transactions t
            LEFT JOIN invoices i ON i.id = t.matched_invoice_id
            WHERE t.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ' AND t.status = $' + params.length;
        }
        if (type === 'credit') {
            query += ' AND t.amount > 0';
        } else if (type === 'debit') {
            query += ' AND t.amount < 0';
        }
        if (from) {
            params.push(from);
            query += ' AND t.transaction_date >= $' + params.length;
        }
        if (to) {
            params.push(to);
            query += ' AND t.transaction_date <= $' + params.length;
        }

        query += ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT 500';

        const result = await pool.query(query, params);

        res.json(result.rows.map(t => ({
            id: t.id,
            date: t.transaction_date,
            valueDate: t.value_date,
            amount: parseFloat(t.amount),
            currency: t.currency,
            description: t.description,
            counterparty: t.counterparty,
            reference: t.reference,
            transactionType: t.transaction_type,
            matchedInvoiceId: t.matched_invoice_id,
            invoiceNumber: t.invoice_number,
            invoiceClientName: t.invoice_client_name,
            invoiceTotal: t.invoice_total ? parseFloat(t.invoice_total) : null,
            matchScore: t.match_score,
            matchReason: t.match_reason,
            status: t.status,
            validatedAt: t.validated_at,
            createdAt: t.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/bank/transactions/:id/matches — Correspondances proposees
// ============================================================
router.get('/transactions/:id/matches', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const txResult = await pool.query(
            'SELECT * FROM bank_transactions WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (txResult.rows.length === 0) {
            return res.status(404).json({ error: 'Transaction introuvable.' });
        }

        const matches = await findMatches(txResult.rows[0], req.user.id);

        res.json({
            transaction: {
                id: txResult.rows[0].id,
                date: txResult.rows[0].transaction_date,
                amount: parseFloat(txResult.rows[0].amount),
                currency: txResult.rows[0].currency,
                description: txResult.rows[0].description
            },
            matches: matches
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/bank/transactions/:id/validate — Valider un rapprochement
// ============================================================
router.post('/transactions/:id/validate', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { invoiceId } = req.body;

    if (!invoiceId) {
        return res.status(400).json({ error: 'invoiceId requis.' });
    }

    try {
        const result = await validateMatch(req.user.id, id, parseInt(invoiceId));
        res.json(result);
    } catch (err) {
        console.error('Erreur validation match:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// POST /api/bank/transactions/:id/ignore — Ignorer une transaction
// ============================================================
router.post('/transactions/:id/ignore', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE bank_transactions
            SET status = 'ignored', validated_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [id, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Transaction introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/bank/rematch — Relancer le matching automatique
// ============================================================
router.post('/rematch', authenticateToken, async (req, res) => {
    try {
        const result = await autoMatchAll(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Erreur rematch:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/bank/stats — Statistiques
// ============================================================
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'suggested') as suggested,
                COUNT(*) FILTER (WHERE status = 'validated') as validated,
                COUNT(*) FILTER (WHERE status = 'ignored') as ignored,
                COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND status = 'validated'), 0) as total_reconciled
            FROM bank_transactions
            WHERE user_id = $1
        `, [req.user.id]);

        const r = result.rows[0];

        res.json({
            total: parseInt(r.total),
            pending: parseInt(r.pending),
            suggested: parseInt(r.suggested),
            validated: parseInt(r.validated),
            ignored: parseInt(r.ignored),
            totalReconciled: parseFloat(r.total_reconciled)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/bank/transactions/:id — Supprimer une transaction
// ============================================================
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM bank_transactions WHERE id = $1 AND user_id = $2 AND status != \'validated\' RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Transaction introuvable ou deja validee.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;