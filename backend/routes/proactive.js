// backend/routes/proactive.js
// Routes de l'assistant proactif

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    getProactiveSettings,
    runDetectionForUser
} = require('../utils/proactive/detector');

const router = express.Router();

// ============================================================
// GET /api/proactive/suggestions — Suggestions actives
// ============================================================
router.get('/suggestions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*,
                   q.quote_number,
                   i.invoice_number,
                   ch.name as chantier_name
            FROM assistant_suggestions s
            LEFT JOIN quotes q ON q.id = s.related_quote_id
            LEFT JOIN invoices i ON i.id = s.related_invoice_id
            LEFT JOIN chantiers ch ON ch.id = s.related_chantier_id
            WHERE s.user_id = $1 AND s.status = 'active'
            ORDER BY s.priority DESC, s.created_at DESC
            LIMIT 50
        `, [req.user.id]);

        res.json(result.rows.map(s => ({
            id: s.id,
            type: s.suggestion_type,
            title: s.title,
            message: s.message,
            actionType: s.action_type,
            actionPayload: s.action_payload,
            quoteNumber: s.quote_number,
            invoiceNumber: s.invoice_number,
            chantierName: s.chantier_name,
            relatedQuoteId: s.related_quote_id,
            relatedInvoiceId: s.related_invoice_id,
            relatedChantierId: s.related_chantier_id,
            priority: s.priority,
            createdAt: s.created_at
        })));
    } catch (err) {
        console.error('Erreur get suggestions:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/proactive/count — Nombre de suggestions actives
// ============================================================
router.get('/count', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM assistant_suggestions WHERE user_id = $1 AND status = \'active\'',
            [req.user.id]
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/proactive/run — Lancer une detection manuellement
// ============================================================
router.post('/run', authenticateToken, async (req, res) => {
    try {
        const result = await runDetectionForUser(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Erreur run detection:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/proactive/suggestions/:id/dismiss — Masquer
// ============================================================
router.post('/suggestions/:id/dismiss', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE assistant_suggestions
            SET status = 'dismissed', dismissed_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [id, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Suggestion introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/proactive/suggestions/:id/actioned — Marquer comme traitee
// ============================================================
router.post('/suggestions/:id/actioned', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE assistant_suggestions
            SET status = 'actioned', actioned_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [id, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Suggestion introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/proactive/settings — Parametres
// ============================================================
router.get('/settings', authenticateToken, async (req, res) => {
    try {
        const settings = await getProactiveSettings(req.user.id);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/proactive/settings — Modifier les parametres
// ============================================================
router.post('/settings', authenticateToken, async (req, res) => {
    const {
        enabled, dormantQuoteDays, upcomingPaymentDays,
        lowStockEnabled, overdueInvoiceEnabled, dormantQuoteEnabled, upcomingPaymentEnabled
    } = req.body;

    try {
        await pool.query(
            'INSERT INTO proactive_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        const updates = [];
        const params = [req.user.id];
        let idx = 2;

        if (enabled !== undefined) { updates.push('enabled = $' + idx); params.push(enabled === true); idx++; }
        if (dormantQuoteDays !== undefined) { updates.push('dormant_quote_days = $' + idx); params.push(Math.max(1, Math.min(parseInt(dormantQuoteDays) || 14, 365))); idx++; }
        if (upcomingPaymentDays !== undefined) { updates.push('upcoming_payment_days = $' + idx); params.push(Math.max(1, Math.min(parseInt(upcomingPaymentDays) || 3, 30))); idx++; }
        if (lowStockEnabled !== undefined) { updates.push('low_stock_enabled = $' + idx); params.push(lowStockEnabled === true); idx++; }
        if (overdueInvoiceEnabled !== undefined) { updates.push('overdue_invoice_enabled = $' + idx); params.push(overdueInvoiceEnabled === true); idx++; }
        if (dormantQuoteEnabled !== undefined) { updates.push('dormant_quote_enabled = $' + idx); params.push(dormantQuoteEnabled === true); idx++; }
        if (upcomingPaymentEnabled !== undefined) { updates.push('upcoming_payment_enabled = $' + idx); params.push(upcomingPaymentEnabled === true); idx++; }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune modification.' });
        }

        updates.push('updated_at = NOW()');

        await pool.query(
            'UPDATE proactive_settings SET ' + updates.join(', ') + ' WHERE user_id = $1',
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur save proactive settings:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;