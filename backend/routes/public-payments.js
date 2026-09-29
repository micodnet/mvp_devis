// backend/routes/public-payments.js
// Routes publiques pour le paiement en ligne d'une facture

const express = require('express');
const { pool } = require('../db');
const { createCheckoutSessionForInvoice } = require('../utils/stripe/checkout');

const router = express.Router();

// ============================================================
// GET /api/public-payments/invoice/:token — Infos facture publique
// ============================================================
router.get('/invoice/:token', async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 16) {
        return res.status(400).json({ error: 'Token invalide.' });
    }

    try {
        const result = await pool.query(`
            SELECT i.*, u.id as owner_id
            FROM invoices i
            JOIN users u ON u.id = i.user_id
            WHERE i.public_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const invoice = result.rows[0];

        const settingsResult = await pool.query(
            'SELECT company_name, logo, address, phone, email, website FROM settings WHERE user_id = $1',
            [invoice.owner_id]
        );
        const s = settingsResult.rows[0] || {};

        const cfgResult = await pool.query(
            'SELECT stripe_enabled FROM settings WHERE user_id = $1',
            [invoice.owner_id]
        );
        const stripeEnabled = cfgResult.rows[0]?.stripe_enabled === true;

        res.json({
            invoice: {
                number: invoice.invoice_number,
                issueDate: invoice.issue_date,
                dueDate: invoice.due_date,
                total: parseFloat(invoice.total),
                amountPaid: parseFloat(invoice.amount_paid) || 0,
                amountDue: parseFloat(invoice.amount_due) || parseFloat(invoice.total),
                currency: invoice.currency || 'EUR',
                status: invoice.status,
                clientName: invoice.client_name,
                items: invoice.items
            },
            company: {
                companyName: s.company_name,
                logo: s.logo,
                address: s.address,
                phone: s.phone,
                email: s.email,
                website: s.website
            },
            stripeEnabled: stripeEnabled
        });
    } catch (err) {
        console.error('Erreur public invoice:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/public-payments/invoice/:token/checkout
// Cree une session de paiement Stripe (sans auth)
// ============================================================
router.post('/invoice/:token/checkout', async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token requis.' });

    try {
        const result = await pool.query(`
            SELECT i.*, u.id as owner_id
            FROM invoices i
            JOIN users u ON u.id = i.user_id
            WHERE i.public_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const invoice = result.rows[0];

        if (invoice.status === 'paid') {
            return res.status(400).json({ error: 'Cette facture est deja payee.' });
        }

        const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');

        const session = await createCheckoutSessionForInvoice(invoice.owner_id, invoice, baseUrl);

        res.json({
            success: true,
            checkoutUrl: session.url,
            sessionId: session.sessionId
        });
    } catch (err) {
        console.error('Erreur public checkout:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;