// backend/routes/api-public.js
// API publique accessible via cle API

const express = require('express');
const { pool } = require('../db');
const { requireApiKey } = require('../middleware/api-auth');

const router = express.Router();

// ============================================================
// GET /api/v1/me — Informations sur le compte
// ============================================================
router.get('/me', requireApiKey('read'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT email, created_at FROM users WHERE id = $1',
            [req.apiUser.id]
        );
        const user = result.rows[0];
        res.json({
            email: user.email,
            createdAt: user.created_at,
            scopes: req.apiUser.scopes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/quotes — Liste des devis
// ============================================================
router.get('/quotes', requireApiKey('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const status = req.query.status;
        const from = req.query.from;
        const to = req.query.to;

        let query = 'SELECT * FROM quotes WHERE user_id = $1';
        const params = [req.apiUser.id];

        if (status) {
            params.push(status);
            query += ' AND status = $' + params.length;
        }
        if (from) {
            params.push(from);
            query += ' AND issue_date >= $' + params.length;
        }
        if (to) {
            params.push(to);
            query += ' AND issue_date <= $' + params.length;
        }

        query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await pool.query(query, params);

        res.json(result.rows.map(q => ({
            id: q.id,
            number: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            clientName: q.client_name,
            clientEmail: q.client_email,
            subtotal: parseFloat(q.subtotal),
            vatAmount: parseFloat(q.vat_amount),
            total: parseFloat(q.total),
            currency: q.currency || 'EUR',
            status: q.status,
            items: q.items,
            createdAt: q.created_at,
            publicToken: q.public_token
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/quotes/:id — Detail d'un devis
// ============================================================
router.get('/quotes/:id', requireApiKey('read'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [id, req.apiUser.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }
        const q = result.rows[0];

        res.json({
            id: q.id,
            number: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            clientName: q.client_name,
            clientAddress: q.client_address,
            clientVat: q.client_vat,
            clientEmail: q.client_email,
            subtotal: parseFloat(q.subtotal),
            vatAmount: parseFloat(q.vat_amount),
            total: parseFloat(q.total),
            vatRegime: q.vat_regime,
            currency: q.currency || 'EUR',
            status: q.status,
            items: q.items,
            signature: q.signature_signed_at ? {
                signedBy: q.signature_signed_by,
                signedAt: q.signature_signed_at,
                method: q.signature_method
            } : null,
            createdAt: q.created_at,
            publicToken: q.public_token
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/v1/quotes — Creer un devis
// ============================================================
router.post('/quotes', requireApiKey('write'), async (req, res) => {
    const { items, clientName, clientEmail, clientAddress, clientVat, vatRegime } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Le champ items est requis (tableau non vide).' });
    }

    try {
        // Recuperer les settings
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.apiUser.id]
        );
        const settings = settingsResult.rows[0] || {};

        // Calculer les totaux
        let subtotal = 0;
        const formattedItems = items.map(item => {
            const qty = parseFloat(item.qty) || 1;
            const unitPrice = parseFloat(item.unitPrice) || 0;
            const total = qty * unitPrice;
            subtotal += total;
            return {
                ref: item.ref || 'EXT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
                name: item.name || 'Article',
                qty,
                unitPrice,
                total
            };
        });

        const vatReg = vatRegime || settings.vat_regime || 'franchise';
        const vatRate = parseFloat(settings.vat_rate) || 21;
        const vatAmount = vatReg === 'assujetti' ? Math.round(subtotal * (vatRate / 100) * 100) / 100 : 0;
        const total = Math.round((subtotal + vatAmount) * 100) / 100;

        // Numero de devis
        const counterResult = await pool.query(
            'SELECT last_number FROM counters WHERE user_id = $1',
            [req.apiUser.id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await pool.query('UPDATE counters SET last_number = $1 WHERE user_id = $2', [newNumber, req.apiUser.id]);
        } else {
            await pool.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 1)', [req.apiUser.id]);
        }
        const quoteNumber = 'DEVIS-' + String(newNumber).padStart(4, '0') + '-' + new Date().getFullYear();

        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const validDate = validUntil.toISOString().slice(0, 10);

        const result = await pool.query(`
            INSERT INTO quotes (
                user_id, quote_number, issue_date, valid_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_name, client_address, client_vat, client_email,
                currency, exchange_rate
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, $14, 1.0)
            RETURNING id, quote_number, total
        `, [
            req.apiUser.id, quoteNumber, issueDate, validDate,
            subtotal, vatAmount, total, vatReg,
            JSON.stringify(formattedItems),
            clientName || null, clientAddress || null, clientVat || null, clientEmail || null,
            'EUR'
        ]);

        res.status(201).json({
            success: true,
            quote: {
                id: result.rows[0].id,
                number: result.rows[0].quote_number,
                total: parseFloat(result.rows[0].total),
                status: 'draft'
            }
        });
    } catch (err) {
        console.error('Erreur API create quote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/clients — Liste des clients
// ============================================================
router.get('/clients', requireApiKey('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const result = await pool.query(
            'SELECT * FROM clients WHERE user_id = $1 ORDER BY name ASC LIMIT $2',
            [req.apiUser.id, limit]
        );

        res.json(result.rows.map(c => ({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            notes: c.notes,
            createdAt: c.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/v1/clients — Creer un client
// ============================================================
router.post('/clients', requireApiKey('write'), async (req, res) => {
    const { name, contactName, email, phone, address, vatNumber, notes } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom est requis.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO clients (user_id, name, contact_name, email, phone, address, vat_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            req.apiUser.id, name.trim(), contactName || null, email || null,
            phone || null, address || null, vatNumber || null, notes || null
        ]);

        res.status(201).json({
            success: true,
            client: {
                id: result.rows[0].id,
                name: result.rows[0].name,
                email: result.rows[0].email
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/products — Liste des produits
// ============================================================
router.get('/products', requireApiKey('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const result = await pool.query(
            'SELECT * FROM products WHERE user_id = $1 ORDER BY name ASC LIMIT $2',
            [req.apiUser.id, limit]
        );

        res.json(result.rows.map(p => ({
            id: p.id,
            ref: p.ref,
            name: p.name,
            description: p.description,
            category: p.category,
            unit: p.unit,
            unitPrice: parseFloat(p.unit_price),
            stockQuantity: p.track_stock ? parseFloat(p.stock_quantity) : null,
            trackStock: p.track_stock
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/invoices — Liste des factures
// ============================================================
router.get('/invoices', requireApiKey('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const status = req.query.status;

        let query = 'SELECT * FROM invoices WHERE user_id = $1';
        const params = [req.apiUser.id];

        if (status) {
            params.push(status);
            query += ' AND status = $' + params.length;
        }
        query += ' ORDER BY issue_date DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await pool.query(query, params);

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

// ============================================================
// GET /api/v1/chantiers — Liste des chantiers
// ============================================================
router.get('/chantiers', requireApiKey('read'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await pool.query(
            'SELECT * FROM chantiers WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [req.apiUser.id, limit]
        );

        res.json(result.rows.map(c => ({
            id: c.id,
            name: c.name,
            reference: c.reference,
            clientName: c.client_name,
            status: c.status,
            startDate: c.start_date,
            endDate: c.end_date,
            budgetEstimate: c.budget_estimate ? parseFloat(c.budget_estimate) : null,
            createdAt: c.created_at,
            updatedAt: c.updated_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/v1/stats — Statistiques rapides
// ============================================================
router.get('/stats', requireApiKey('read'), async (req, res) => {
    try {
        const [quotes, invoices, clients, products] = await Promise.all([
            pool.query(`
                SELECT COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
                    COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as revenue
                FROM quotes WHERE user_id = $1
            `, [req.apiUser.id]),
            pool.query(`
                SELECT COUNT(*) as total,
                    COALESCE(SUM(amount_due), 0) as due
                FROM invoices WHERE user_id = $1 AND status IN ('sent', 'partial', 'overdue')
            `, [req.apiUser.id]),
            pool.query('SELECT COUNT(*) as total FROM clients WHERE user_id = $1', [req.apiUser.id]),
            pool.query('SELECT COUNT(*) as total FROM products WHERE user_id = $1', [req.apiUser.id])
        ]);

        res.json({
            quotes: {
                total: parseInt(quotes.rows[0].total),
                accepted: parseInt(quotes.rows[0].accepted),
                revenue: parseFloat(quotes.rows[0].revenue)
            },
            invoices: {
                total: parseInt(invoices.rows[0].total),
                dueAmount: parseFloat(invoices.rows[0].due)
            },
            clients: parseInt(clients.rows[0].total),
            products: parseInt(products.rows[0].total)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;