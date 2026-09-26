// backend/routes/oauth-api.js
// API v1 accessible par OAuth OU par cle API

const express = require('express');
const { pool } = require('../db');
const { requireOAuth } = require('../middleware/oauth-auth');

const router = express.Router();

router.get('/me', requireOAuth('read'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT email, created_at FROM users WHERE id = $1',
            [req.oauthUser.id]
        );
        const user = result.rows[0];
        res.json({
            email: user.email,
            createdAt: user.created_at,
            scopes: req.oauthUser.scopes,
            clientId: req.oauthUser.clientId
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/quotes', requireOAuth('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await pool.query(
            'SELECT id, quote_number, issue_date, valid_date, client_name, subtotal, vat_amount, total, currency, status FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
            [req.oauthUser.id, limit]
        );
        res.json(result.rows.map(q => ({
            id: q.id,
            number: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            clientName: q.client_name,
            subtotal: parseFloat(q.subtotal),
            vatAmount: parseFloat(q.vat_amount),
            total: parseFloat(q.total),
            currency: q.currency || 'EUR',
            status: q.status
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/clients', requireOAuth('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const result = await pool.query(
            'SELECT id, name, contact_name, email, phone, address, vat_number FROM clients WHERE user_id = $1 ORDER BY name ASC LIMIT $2',
            [req.oauthUser.id, limit]
        );
        res.json(result.rows.map(c => ({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/products', requireOAuth('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const result = await pool.query(
            'SELECT id, ref, name, description, category, unit, unit_price, track_stock, stock_quantity FROM products WHERE user_id = $1 ORDER BY name ASC LIMIT $2',
            [req.oauthUser.id, limit]
        );
        res.json(result.rows.map(p => ({
            id: p.id,
            ref: p.ref,
            name: p.name,
            description: p.description,
            category: p.category,
            unit: p.unit,
            unitPrice: parseFloat(p.unit_price),
            trackStock: p.track_stock,
            stockQuantity: p.track_stock ? parseFloat(p.stock_quantity) : null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/invoices', requireOAuth('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await pool.query(
            'SELECT id, invoice_number, invoice_type, issue_date, due_date, client_name, subtotal, vat_amount, total, amount_paid, amount_due, currency, status FROM invoices WHERE user_id = $1 ORDER BY issue_date DESC LIMIT $2',
            [req.oauthUser.id, limit]
        );
        res.json(result.rows.map(i => ({
            id: i.id,
            number: i.invoice_number,
            type: i.invoice_type,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            clientName: i.client_name,
            subtotal: parseFloat(i.subtotal),
            vatAmount: parseFloat(i.vat_amount),
            total: parseFloat(i.total),
            amountPaid: parseFloat(i.amount_paid) || 0,
            amountDue: parseFloat(i.amount_due) || parseFloat(i.total),
            currency: i.currency || 'EUR',
            status: i.status
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/chantiers', requireOAuth('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await pool.query(
            'SELECT id, name, reference, client_name, status, start_date, end_date, budget_estimate FROM chantiers WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [req.oauthUser.id, limit]
        );
        res.json(result.rows.map(c => ({
            id: c.id,
            name: c.name,
            reference: c.reference,
            clientName: c.client_name,
            status: c.status,
            startDate: c.start_date,
            endDate: c.end_date,
            budgetEstimate: c.budget_estimate ? parseFloat(c.budget_estimate) : null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/stats', requireOAuth('read'), async (req, res) => {
    try {
        const [q, i, c, p] = await Promise.all([
            pool.query(`
                SELECT COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
                    COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as revenue
                FROM quotes WHERE user_id = $1
            `, [req.oauthUser.id]),
            pool.query(`
                SELECT COUNT(*) as total, COALESCE(SUM(amount_due), 0) as due
                FROM invoices WHERE user_id = $1 AND status IN ('sent', 'partial', 'overdue')
            `, [req.oauthUser.id]),
            pool.query('SELECT COUNT(*) as total FROM clients WHERE user_id = $1', [req.oauthUser.id]),
            pool.query('SELECT COUNT(*) as total FROM products WHERE user_id = $1', [req.oauthUser.id])
        ]);
        res.json({
            quotes: {
                total: parseInt(q.rows[0].total),
                accepted: parseInt(q.rows[0].accepted),
                revenue: parseFloat(q.rows[0].revenue)
            },
            invoices: {
                total: parseInt(i.rows[0].total),
                dueAmount: parseFloat(i.rows[0].due)
            },
            clients: parseInt(c.rows[0].total),
            products: parseInt(p.rows[0].total)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;