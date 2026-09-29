// backend/routes/online-payments.js
// Routes pour les paiements en ligne via Stripe

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    getUserStripeConfig,
    createCheckoutSessionForInvoice,
    listPayments
} = require('../utils/stripe/checkout');

const router = express.Router();

// ============================================================
// GET /api/online-payments/config — Config Stripe actuelle
// ============================================================
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT stripe_enabled, stripe_public_key,
                   CASE WHEN stripe_secret_key IS NOT NULL THEN TRUE ELSE FALSE END as has_secret
            FROM settings WHERE user_id = $1
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                publicKey: '',
                hasSecret: false
            });
        }

        const s = result.rows[0];
        res.json({
            enabled: s.stripe_enabled || false,
            publicKey: s.stripe_public_key || '',
            hasSecret: !!s.has_secret
        });
    } catch (err) {
        console.error('Erreur get stripe config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/online-payments/config — Sauvegarder la config
// ============================================================
router.post('/config', authenticateToken, async (req, res) => {
    const { enabled, publicKey, secretKey, webhookSecret } = req.body;

    try {
        await pool.query(
            'INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        const updates = [];
        const params = [req.user.id];
        let idx = 2;

        if (enabled !== undefined) {
            updates.push('stripe_enabled = $' + idx);
            params.push(enabled === true);
            idx++;
        }
        if (publicKey !== undefined) {
            updates.push('stripe_public_key = $' + idx);
            params.push(publicKey || null);
            idx++;
        }
        if (secretKey !== undefined && secretKey !== '') {
            updates.push('stripe_secret_key = $' + idx);
            params.push(secretKey);
            idx++;
        }
        if (webhookSecret !== undefined && webhookSecret !== '') {
            updates.push('stripe_webhook_secret = $' + idx);
            params.push(webhookSecret);
            idx++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune modification.' });
        }

        updates.push('updated_at = NOW()');

        await pool.query(
            'UPDATE settings SET ' + updates.join(', ') + ' WHERE user_id = $1',
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur save stripe config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/online-payments — Historique des paiements
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const payments = await listPayments(req.user.id, limit);
        res.json(payments);
    } catch (err) {
        console.error('Erreur list payments:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/online-payments/invoice/:invoiceId/checkout
// Cree une session de paiement Stripe pour une facture
// ============================================================
router.post('/invoice/:invoiceId/checkout', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Charger la facture
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );

        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const invoice = invoiceResult.rows[0];

        if (invoice.status === 'paid') {
            return res.status(400).json({ error: 'Cette facture est deja payee.' });
        }

        const amount = parseFloat(invoice.amount_due || invoice.total);
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }

        // URL de base
        const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');

        const session = await createCheckoutSessionForInvoice(req.user.id, invoice, baseUrl);

        res.json({
            success: true,
            sessionId: session.sessionId,
            checkoutUrl: session.url,
            paymentId: session.paymentId
        });
    } catch (err) {
        console.error('Erreur create checkout:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/online-payments/stats — Statistiques
// ============================================================
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const [total, month, pending, sum] = await Promise.all([
            pool.query(
                'SELECT COUNT(*) FROM online_payments WHERE user_id = $1 AND status = $2',
                [req.user.id, 'paid']
            ),
            pool.query(`
                SELECT COUNT(*) FROM online_payments
                WHERE user_id = $1 AND status = 'paid'
                  AND paid_at > NOW() - INTERVAL '30 days'
            `, [req.user.id]),
            pool.query(
                'SELECT COUNT(*) FROM online_payments WHERE user_id = $1 AND status = $2',
                [req.user.id, 'pending']
            ),
            pool.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM online_payments
                WHERE user_id = $1 AND status = 'paid'
            `, [req.user.id])
        ]);

        res.json({
            totalPaid: parseInt(total.rows[0].count),
            last30Days: parseInt(month.rows[0].count),
            pending: parseInt(pending.rows[0].count),
            totalAmount: parseFloat(sum.rows[0].total)
        });
    } catch (err) {
        console.error('Erreur stripe stats:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;