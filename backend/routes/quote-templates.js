// backend/routes/quote-templates.js
// CRUD des modeles de devis + application a un nouveau devis

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/quote-templates — Liste des modeles
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { category, search } = req.query;

        let query = 'SELECT * FROM quote_templates WHERE user_id = $1';
        const params = [req.user.id];

        if (category) {
            params.push(category);
            query += ' AND category = $' + params.length;
        }

        if (search) {
            params.push('%' + search.toLowerCase() + '%');
            query += ' AND (LOWER(name) LIKE $' + params.length + ' OR LOWER(description) LIKE $' + params.length + ')';
        }

        query += ' ORDER BY usage_count DESC, name ASC';

        const result = await pool.query(query, params);

        res.json(result.rows.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            color: t.color,
            clientId: t.client_id,
            clientName: t.client_name,
            items: t.items || [],
            subtotal: parseFloat(t.subtotal) || 0,
            vatAmount: parseFloat(t.vat_amount) || 0,
            total: parseFloat(t.total) || 0,
            vatRegime: t.vat_regime || 'franchise',
            vatRate: parseFloat(t.vat_rate) || 21,
            prepopulateClient: t.prepopulate_client,
            usageCount: t.usage_count || 0,
            lastUsedAt: t.last_used_at,
            createdAt: t.created_at,
            updatedAt: t.updated_at
        })));
    } catch (err) {
        console.error('Erreur list quote templates:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/quote-templates/categories — Categories existantes
// ============================================================
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT category FROM quote_templates
            WHERE user_id = $1 AND category IS NOT NULL AND category != ''
            ORDER BY category ASC
        `, [req.user.id]);

        res.json(result.rows.map(r => r.category));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quote-templates/categories/rename — Renommer une categorie
// ============================================================
router.post('/categories/rename', authenticateToken, async (req, res) => {
    const { oldName, newName } = req.body;

    if (!oldName || !newName || !newName.trim()) {
        return res.status(400).json({ error: 'Ancien et nouveau nom requis.' });
    }

    try {
        const result = await pool.query(`
            UPDATE quote_templates
            SET category = $1, updated_at = NOW()
            WHERE user_id = $2 AND category = $3
        `, [newName.trim(), req.user.id, oldName]);

        res.json({ success: true, updated: result.rowCount });
    } catch (err) {
        console.error('Erreur rename category:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/quote-templates/categories/:name — Supprimer une categorie
// ============================================================
router.delete('/categories/:name', authenticateToken, async (req, res) => {
    const categoryName = decodeURIComponent(req.params.name);

    if (!categoryName) {
        return res.status(400).json({ error: 'Nom de categorie requis.' });
    }

    try {
        const result = await pool.query(`
            UPDATE quote_templates
            SET category = NULL, updated_at = NOW()
            WHERE user_id = $1 AND category = $2
        `, [req.user.id, categoryName]);

        res.json({ success: true, updated: result.rowCount });
    } catch (err) {
        console.error('Erreur delete category:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/quote-templates/:id — Detail d'un modele
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM quote_templates WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Modele introuvable.' });
        }

        const t = result.rows[0];

        res.json({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            color: t.color,
            clientId: t.client_id,
            clientName: t.client_name,
            clientAddress: t.client_address,
            clientVat: t.client_vat,
            clientEmail: t.client_email,
            items: t.items || [],
            subtotal: parseFloat(t.subtotal) || 0,
            vatAmount: parseFloat(t.vat_amount) || 0,
            total: parseFloat(t.total) || 0,
            vatRegime: t.vat_regime || 'franchise',
            vatRate: parseFloat(t.vat_rate) || 21,
            prepopulateClient: t.prepopulate_client,
            usageCount: t.usage_count || 0,
            lastUsedAt: t.last_used_at,
            createdAt: t.created_at,
            updatedAt: t.updated_at
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quote-templates — Creer un modele
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        name, description, category, color,
        clientId, clientName, clientAddress, clientVat, clientEmail,
        items, vatRegime, vatRate, prepopulateClient
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du modele est requis.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    try {
        // Calculer les totaux
        let subtotal = 0;
        const formattedItems = [];

        for (const item of items) {
            const qty = parseFloat(item.qty) || 1;
            const unitPrice = parseFloat(item.unitPrice) || 0;
            const total = Math.round(qty * unitPrice * 100) / 100;
            subtotal += total;

            formattedItems.push({
                ref: item.ref || null,
                name: item.name || 'Article',
                qty: qty,
                unitPrice: unitPrice,
                total: total
            });
        }

        subtotal = Math.round(subtotal * 100) / 100;

        // Recuperer le taux de TVA des settings si non fourni
        const settingsResult = await pool.query(
            'SELECT vat_regime, vat_rate FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const s = settingsResult.rows[0] || {};
        const finalVatRegime = vatRegime || s.vat_regime || 'franchise';
        const finalVatRate = parseFloat(vatRate) || parseFloat(s.vat_rate) || 21;

        const vatAmount = finalVatRegime === 'assujetti'
            ? Math.round(subtotal * (finalVatRate / 100) * 100) / 100
            : 0;
        const total = Math.round((subtotal + vatAmount) * 100) / 100;

        const result = await pool.query(`
            INSERT INTO quote_templates (
                user_id, name, description, category, color,
                client_id, client_name, client_address, client_vat, client_email,
                items, subtotal, vat_amount, total, vat_regime, vat_rate,
                prepopulate_client
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `, [
            req.user.id,
            name.trim(),
            description || null,
            category || null,
            color || '#f97316',
            clientId || null,
            clientName || null,
            clientAddress || null,
            clientVat || null,
            clientEmail || null,
            JSON.stringify(formattedItems),
            subtotal,
            vatAmount,
            total,
            finalVatRegime,
            finalVatRate,
            prepopulateClient === true
        ]);

        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        console.error('Erreur create quote template:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quote-templates/from-quote/:quoteId — Depuis un devis existant
// ============================================================
router.post('/from-quote/:quoteId', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.quoteId);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    const { name, description, category, color, prepopulateClient } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du modele est requis.' });
    }

    try {
        const quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );

        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const quote = quoteResult.rows[0];

        const result = await pool.query(`
            INSERT INTO quote_templates (
                user_id, name, description, category, color,
                client_id, client_name, client_address, client_vat, client_email,
                items, subtotal, vat_amount, total, vat_regime, vat_rate,
                prepopulate_client
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `, [
            req.user.id,
            name.trim(),
            description || null,
            category || null,
            color || '#f97316',
            quote.client_id || null,
            quote.client_name || null,
            quote.client_address || null,
            quote.client_vat || null,
            quote.client_email || null,
            JSON.stringify(quote.items || []),
            quote.subtotal || 0,
            quote.vat_amount || 0,
            quote.total || 0,
            quote.vat_regime || 'franchise',
            21,
            prepopulateClient === true
        ]);

        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        console.error('Erreur create template from quote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/quote-templates/:id — Modifier un modele
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const {
        name, description, category, color,
        clientId, clientName, clientAddress, clientVat, clientEmail,
        items, vatRegime, vatRate, prepopulateClient
    } = req.body;

    try {
        // Charger le modele existant
        const existing = await pool.query(
            'SELECT * FROM quote_templates WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Modele introuvable.' });
        }

        let subtotal = parseFloat(existing.rows[0].subtotal) || 0;
        let vatAmount = parseFloat(existing.rows[0].vat_amount) || 0;
        let total = parseFloat(existing.rows[0].total) || 0;
        let formattedItems = existing.rows[0].items || [];
        const finalVatRegime = vatRegime || existing.rows[0].vat_regime || 'franchise';
        const finalVatRate = parseFloat(vatRate) || parseFloat(existing.rows[0].vat_rate) || 21;

        if (Array.isArray(items) && items.length > 0) {
            subtotal = 0;
            formattedItems = [];

            for (const item of items) {
                const qty = parseFloat(item.qty) || 1;
                const unitPrice = parseFloat(item.unitPrice) || 0;
                const lineTotal = Math.round(qty * unitPrice * 100) / 100;
                subtotal += lineTotal;

                formattedItems.push({
                    ref: item.ref || null,
                    name: item.name || 'Article',
                    qty: qty,
                    unitPrice: unitPrice,
                    total: lineTotal
                });
            }

            subtotal = Math.round(subtotal * 100) / 100;
            vatAmount = finalVatRegime === 'assujetti'
                ? Math.round(subtotal * (finalVatRate / 100) * 100) / 100
                : 0;
            total = Math.round((subtotal + vatAmount) * 100) / 100;
        }

        const result = await pool.query(`
            UPDATE quote_templates SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                category = COALESCE($3, category),
                color = COALESCE($4, color),
                client_id = COALESCE($5, client_id),
                client_name = COALESCE($6, client_name),
                client_address = COALESCE($7, client_address),
                client_vat = COALESCE($8, client_vat),
                client_email = COALESCE($9, client_email),
                items = $10,
                subtotal = $11,
                vat_amount = $12,
                total = $13,
                vat_regime = $14,
                vat_rate = $15,
                prepopulate_client = COALESCE($16, prepopulate_client),
                updated_at = NOW()
            WHERE id = $17 AND user_id = $18
            RETURNING *
        `, [
            name || null,
            description !== undefined ? description : null,
            category !== undefined ? category : null,
            color || null,
            clientId || null,
            clientName || null,
            clientAddress || null,
            clientVat || null,
            clientEmail || null,
            JSON.stringify(formattedItems),
            subtotal,
            vatAmount,
            total,
            finalVatRegime,
            finalVatRate,
            prepopulateClient !== undefined ? (prepopulateClient === true) : null,
            id,
            req.user.id
        ]);

        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        console.error('Erreur update template:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/quote-templates/:id — Supprimer un modele
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM quote_templates WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Modele introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quote-templates/:id/use — Creer un devis depuis un modele
// ============================================================
router.post('/:id/use', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Charger le modele
        const templateResult = await pool.query(
            'SELECT * FROM quote_templates WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (templateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Modele introuvable.' });
        }

        const template = templateResult.rows[0];

        // Charger les settings
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};

        // Numero de devis
        const counterResult = await pool.query(
            'SELECT last_number FROM counters WHERE user_id = $1',
            [req.user.id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await pool.query(
                'UPDATE counters SET last_number = $1 WHERE user_id = $2',
                [newNumber, req.user.id]
            );
        } else {
            await pool.query(
                'INSERT INTO counters (user_id, last_number) VALUES ($1, 1)',
                [req.user.id]
            );
        }
        const quoteNumber = 'DEVIS-' + String(newNumber).padStart(4, '0') + '-' + new Date().getFullYear();

        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const validDate = validUntil.toISOString().slice(0, 10);

        // Client : prepopule si le modele l'a demande
        const clientId = template.prepopulate_client ? template.client_id : null;
        const clientName = template.prepopulate_client ? template.client_name : '';
        const clientAddress = template.prepopulate_client ? template.client_address : '';
        const clientVat = template.prepopulate_client ? template.client_vat : '';
        const clientEmail = template.prepopulate_client ? template.client_email : '';

        const insertResult = await pool.query(`
            INSERT INTO quotes (
                user_id, quote_number, issue_date, valid_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_id, client_name, client_address, client_vat, client_email,
                currency, exchange_rate
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9,
                    $10, $11, $12, $13, $14, 'EUR', 1.0)
            RETURNING id
        `, [
            req.user.id,
            quoteNumber,
            issueDate,
            validDate,
            template.subtotal,
            template.vat_amount,
            template.total,
            template.vat_regime,
            JSON.stringify(template.items || []),
            clientId,
            clientName,
            clientAddress,
            clientVat,
            clientEmail
        ]);

        const quoteId = insertResult.rows[0].id;

        // Mettre a jour le compteur d'utilisation
        await pool.query(`
            UPDATE quote_templates
            SET usage_count = COALESCE(usage_count, 0) + 1,
                last_used_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [id]);

        res.json({
            success: true,
            quoteId,
            quoteNumber
        });
    } catch (err) {
        console.error('Erreur use template:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quote-templates/:id/duplicate — Dupliquer un modele
// ============================================================
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const originalResult = await pool.query(
            'SELECT * FROM quote_templates WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (originalResult.rows.length === 0) {
            return res.status(404).json({ error: 'Modele introuvable.' });
        }

        const orig = originalResult.rows[0];

        const result = await pool.query(`
            INSERT INTO quote_templates (
                user_id, name, description, category, color,
                client_id, client_name, client_address, client_vat, client_email,
                items, subtotal, vat_amount, total, vat_regime, vat_rate,
                prepopulate_client
            )
            SELECT
                user_id, $1, description, category, color,
                client_id, client_name, client_address, client_vat, client_email,
                items, subtotal, vat_amount, total, vat_regime, vat_rate,
                prepopulate_client
            FROM quote_templates WHERE id = $2
            RETURNING *
        `, [orig.name + ' (copie)', id]);

        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        console.error('Erreur duplicate template:', err);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;