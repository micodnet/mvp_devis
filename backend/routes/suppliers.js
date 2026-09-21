// backend/routes/suppliers.js
// CRUD du carnet fournisseurs

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/suppliers — Liste des fournisseurs
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM suppliers WHERE user_id = $1 AND active = TRUE ORDER BY name ASC',
            [req.user.id]
        );
        res.json(result.rows.map(s => ({
            id: s.id,
            name: s.name,
            contactName: s.contact_name,
            email: s.email,
            phone: s.phone,
            address: s.address,
            vatNumber: s.vat_number,
            iban: s.iban,
            bic: s.bic,
            website: s.website,
            category: s.category,
            deliveryDays: s.delivery_days,
            paymentTerms: s.payment_terms,
            notes: s.notes,
            active: s.active
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/suppliers/:id — Détail d'un fournisseur
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM suppliers WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Fournisseur non trouvé.' });
        const s = result.rows[0];
        res.json({
            id: s.id,
            name: s.name,
            contactName: s.contact_name,
            email: s.email,
            phone: s.phone,
            address: s.address,
            vatNumber: s.vat_number,
            iban: s.iban,
            bic: s.bic,
            website: s.website,
            category: s.category,
            deliveryDays: s.delivery_days,
            paymentTerms: s.payment_terms,
            notes: s.notes,
            active: s.active
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/suppliers — Créer un fournisseur
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { name, contactName, email, phone, address, vatNumber, iban, bic, website, category, deliveryDays, paymentTerms, notes } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du fournisseur est requis.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO suppliers (
                user_id, name, contact_name, email, phone, address,
                vat_number, iban, bic, website, category, delivery_days, payment_terms, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            req.user.id, name.trim(), contactName || null, email || null, phone || null, address || null,
            vatNumber || null, iban || null, bic || null, website || null,
            category || null, parseInt(deliveryDays) || 7, parseInt(paymentTerms) || 30, notes || null
        ]);

        const s = result.rows[0];
        res.status(201).json({
            id: s.id,
            name: s.name,
            contactName: s.contact_name,
            email: s.email,
            phone: s.phone,
            address: s.address,
            vatNumber: s.vat_number,
            iban: s.iban,
            bic: s.bic,
            website: s.website,
            category: s.category,
            deliveryDays: s.delivery_days,
            paymentTerms: s.payment_terms,
            notes: s.notes,
            active: s.active
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/suppliers/:id — Modifier un fournisseur
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { name, contactName, email, phone, address, vatNumber, iban, bic, website, category, deliveryDays, paymentTerms, notes } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du fournisseur est requis.' });
    }

    try {
        const result = await pool.query(`
            UPDATE suppliers
            SET name = $1, contact_name = $2, email = $3, phone = $4, address = $5,
                vat_number = $6, iban = $7, bic = $8, website = $9, category = $10,
                delivery_days = $11, payment_terms = $12, notes = $13, updated_at = NOW()
            WHERE id = $14 AND user_id = $15
            RETURNING *
        `, [
            name.trim(), contactName || null, email || null, phone || null, address || null,
            vatNumber || null, iban || null, bic || null, website || null,
            category || null, parseInt(deliveryDays) || 7, parseInt(paymentTerms) || 30,
            notes || null, id, req.user.id
        ]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Fournisseur non trouvé.' });

        const s = result.rows[0];
        res.json({
            id: s.id,
            name: s.name,
            contactName: s.contact_name,
            email: s.email,
            phone: s.phone,
            address: s.address,
            vatNumber: s.vat_number,
            iban: s.iban,
            bic: s.bic,
            website: s.website,
            category: s.category,
            deliveryDays: s.delivery_days,
            paymentTerms: s.payment_terms,
            notes: s.notes,
            active: s.active
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/suppliers/:id — Désactiver (soft delete)
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'UPDATE suppliers SET active = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Fournisseur non trouvé.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;