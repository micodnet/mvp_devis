// backend/routes/email-import.js
// Import d'emails clients

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { analyzeEmail, convertToQuote } = require('../utils/email/importer');

const router = express.Router();

// ============================================================
// POST /api/email-import/analyze — Analyser un email
// ============================================================
router.post('/analyze', authenticateToken, async (req, res) => {
    const { text, fromEmail, fromName, subject } = req.body;

    if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: 'Le texte de l\'email est trop court (20 caracteres minimum).' });
    }

    try {
        const result = await analyzeEmail(req.user.id, text, { fromEmail, fromName, subject });

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (err) {
        console.error('Erreur analyze email:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/email-import/:id/convert — Convertir en devis
// ============================================================
router.post('/:id/convert', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const overrides = req.body || {};

    try {
        const result = await convertToQuote(req.user.id, id, overrides);
        res.json({ success: true, quote: result });
    } catch (err) {
        console.error('Erreur convert email:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/email-import — Historique des imports
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const result = await pool.query(`
            SELECT ei.*, q.quote_number, q.total as quote_total
            FROM email_imports ei
            LEFT JOIN quotes q ON q.id = ei.quote_id
            WHERE ei.user_id = $1
            ORDER BY ei.created_at DESC
            LIMIT $2
        `, [req.user.id, limit]);

        res.json(result.rows.map(r => ({
            id: r.id,
            fromEmail: r.from_email,
            fromName: r.from_name,
            subject: r.subject,
            extractedData: r.extracted_data,
            quoteId: r.quote_id,
            quoteNumber: r.quote_number,
            quoteTotal: r.quote_total ? parseFloat(r.quote_total) : null,
            status: r.status,
            errorMessage: r.error_message,
            createdAt: r.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/email-import/:id — Detail d'un import
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM email_imports WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Import introuvable.' });
        }

        const r = result.rows[0];
        res.json({
            id: r.id,
            rawText: r.raw_text,
            fromEmail: r.from_email,
            fromName: r.from_name,
            subject: r.subject,
            extractedData: r.extracted_data,
            quoteId: r.quote_id,
            status: r.status,
            errorMessage: r.error_message,
            createdAt: r.created_at
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/email-import/:id — Supprimer un import
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM email_imports WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Import introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;