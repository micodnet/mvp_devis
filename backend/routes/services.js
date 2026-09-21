// backend/routes/services.js
// CRUD des services (main d'œuvre, prestations, forfaits)

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// GET /api/services — Liste des services de l'utilisateur
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM services WHERE user_id = $1 AND active = TRUE ORDER BY is_labor DESC, name ASC',
            [req.user.id]
        );
        res.json(result.rows.map(s => ({
            id: s.id,
            ref: s.ref,
            name: s.name,
            description: s.description,
            unit: s.unit,
            unitPrice: parseFloat(s.unit_price),
            costPrice: parseFloat(s.cost_price) || 0,
            category: s.category,
            isLabor: s.is_labor,
            active: s.active
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/services — Créer un service
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { ref, name, description, unit, unitPrice, costPrice, category, isLabor } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du service est requis.' });
    }
    const price = parseFloat(unitPrice);
    if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Prix invalide.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO services (user_id, ref, name, description, unit, unit_price, cost_price, category, is_labor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [req.user.id, ref || null, name.trim(), description || null, unit || 'forfait', price, costPrice || 0, category || null, isLabor === true]);

        const s = result.rows[0];
        res.status(201).json({
            id: s.id,
            ref: s.ref,
            name: s.name,
            description: s.description,
            unit: s.unit,
            unitPrice: parseFloat(s.unit_price),
            costPrice: parseFloat(s.cost_price) || 0,
            category: s.category,
            isLabor: s.is_labor,
            active: s.active
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/services/:id — Modifier un service
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { ref, name, description, unit, unitPrice, costPrice, category, isLabor } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du service est requis.' });
    }
    const price = parseFloat(unitPrice);
    if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Prix invalide.' });
    }

    try {
        const result = await pool.query(`
            UPDATE services
            SET ref = $1, name = $2, description = $3, unit = $4, unit_price = $5,
                cost_price = $6, category = $7, is_labor = $8, updated_at = NOW()
            WHERE id = $9 AND user_id = $10
            RETURNING *
        `, [ref || null, name.trim(), description || null, unit || 'forfait', price, costPrice || 0, category || null, isLabor === true, id, req.user.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Service non trouvé.' });

        const s = result.rows[0];
        res.json({
            id: s.id,
            ref: s.ref,
            name: s.name,
            description: s.description,
            unit: s.unit,
            unitPrice: parseFloat(s.unit_price),
            costPrice: parseFloat(s.cost_price) || 0,
            category: s.category,
            isLabor: s.is_labor,
            active: s.active
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/services/:id — Désactiver un service (soft delete)
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Soft delete pour ne pas casser les devis existants
        const result = await pool.query(
            'UPDATE services SET active = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Service non trouvé.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/services/import — Import CSV/Excel
// ============================================================
router.post('/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

        if (rows.length < 2) return res.status(400).json({ error: 'Fichier vide.' });

        const normalizeHeader = (str) => String(str || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();

        const headers = rows[0].map(h => normalizeHeader(h));
        const findCol = (...keys) => {
            for (const key of keys) {
                const idx = headers.findIndex(h => h === normalizeHeader(key));
                if (idx !== -1) return idx;
            }
            for (const key of keys) {
                const idx = headers.findIndex(h => h.includes(normalizeHeader(key)));
                if (idx !== -1) return idx;
            }
            return -1;
        };

        const idxName = findCol('name', 'nom', 'designation', 'service', 'prestation');
        const idxRef = findCol('ref', 'reference', 'sku', 'code');
        const idxPrice = findCol('prix', 'price', 'pu', 'tarif', 'montant');
        const idxUnit = findCol('unite', 'unit', 'unite de mesure');
        const idxCategory = findCol('categorie', 'category', 'famille', 'type');
        const idxDesc = findCol('description', 'desc');
        const idxLabor = findCol('maindoeuvre', 'labor', 'is_labor', 'isLabor');

        if (idxName === -1 || idxPrice === -1) {
            return res.status(400).json({
                error: 'Colonnes manquantes. Le fichier doit contenir au minimum "nom" et "prix".'
            });
        }

        const services = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const name = String(row[idxName] || '').trim();
            const priceStr = String(row[idxPrice] || '').replace(',', '.').replace(/[^0-9.-]/g, '');
            const price = parseFloat(priceStr);

            if (!name || isNaN(price)) continue;

            services.push({
                ref: idxRef !== -1 ? String(row[idxRef] || '').trim() || null : null,
                name,
                description: idxDesc !== -1 ? String(row[idxDesc] || '').trim() || null : null,
                unit: idxUnit !== -1 ? String(row[idxUnit] || '').trim() || 'forfait' : 'forfait',
                unitPrice: price,
                category: idxCategory !== -1 ? String(row[idxCategory] || '').trim() || null : null,
                isLabor: idxLabor !== -1 ? ['oui', 'yes', 'true', '1'].includes(String(row[idxLabor]).toLowerCase()) : false
            });
        }

        if (services.length === 0) {
            return res.status(400).json({ error: 'Aucun service valide trouvé.' });
        }

        const values = [];
        const params = [];
        services.forEach((s, idx) => {
            const base = idx * 7;
            values.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`);
            params.push(req.user.id, s.ref, s.name, s.description, s.unit, s.unitPrice, s.category);
        });

        await pool.query(`
            INSERT INTO services (user_id, ref, name, description, unit, unit_price, category)
            VALUES ${values.join(', ')}
        `, params);

        res.json({ success: true, imported: services.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur import : ' + err.message });
    }
});

module.exports = router;