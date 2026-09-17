// backend/routes/products.js
// CRUD des produits du catalogue utilisateur + import CSV/Excel

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Multer en mémoire (pour l'import CSV/XLSX)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// GET /api/products — Liste des produits de l'utilisateur
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM products WHERE user_id = $1 ORDER BY name ASC',
            [req.user.id]
        );
        res.json(result.rows.map(p => ({
            id: p.id,
            ref: p.ref,
            name: p.name,
            description: p.description,
            unit: p.unit,
            unitPrice: parseFloat(p.unit_price),
            category: p.category,
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/products — Créer un produit
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { ref, name, description, unit, unitPrice, category } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du produit est requis.' });
    }
    const price = parseFloat(unitPrice);
    if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Prix invalide.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO products (user_id, ref, name, description, unit, unit_price, category)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [req.user.id, ref || null, name.trim(), description || null, unit || 'u', price, category || null]);

        const p = result.rows[0];
        res.status(201).json({
            id: p.id,
            ref: p.ref,
            name: p.name,
            description: p.description,
            unit: p.unit,
            unitPrice: parseFloat(p.unit_price),
            category: p.category,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/products/:id — Modifier un produit
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const productId = parseInt(req.params.id);
    if (!productId) return res.status(400).json({ error: 'ID invalide.' });

    const { ref, name, description, unit, unitPrice, category } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du produit est requis.' });
    }
    const price = parseFloat(unitPrice);
    if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Prix invalide.' });
    }

    try {
        const result = await pool.query(`
            UPDATE products
            SET ref = $1, name = $2, description = $3, unit = $4, unit_price = $5, category = $6, updated_at = NOW()
            WHERE id = $7 AND user_id = $8
            RETURNING *
        `, [ref || null, name.trim(), description || null, unit || 'u', price, category || null, productId, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produit non trouvé.' });
        }
        const p = result.rows[0];
        res.json({
            id: p.id,
            ref: p.ref,
            name: p.name,
            description: p.description,
            unit: p.unit,
            unitPrice: parseFloat(p.unit_price),
            category: p.category,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/products/:id — Supprimer un produit
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const productId = parseInt(req.params.id);
    if (!productId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM products WHERE id = $1 AND user_id = $2 RETURNING id',
            [productId, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produit non trouvé.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/products/import — Import CSV ou Excel
// ============================================================
router.post('/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

        if (rows.length < 2) {
            return res.status(400).json({ error: 'Fichier vide ou sans données.' });
        }

        // Détection des colonnes via la première ligne (headers)
        // const headers = rows[0].map(h => String(h).toLowerCase().trim());
        // const findCol = (...keys) => {
        //     for (const key of keys) {
        //         const idx = headers.findIndex(h => h.includes(key));
        //         if (idx !== -1) return idx;
        //     }
        //     return -1;
        // };

        // const idxName = findCol('name', 'nom', 'designation', 'désignation', 'produit');
        // const idxRef = findCol('ref', 'réf', 'reference', 'référence', 'sku');
        // const idxPrice = findCol('prix', 'price', 'pu', 'unit_price', 'tarif', 'montant');
        // const idxUnit = findCol('unite', 'unité', 'unit');
        // const idxCategory = findCol('categorie', 'catégorie', 'category');
        // const idxDesc = findCol('description', 'desc');

        // Normalise un header : enlève accents, espaces, caractères spéciaux
        const normalizeHeader = (str) => String(str || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
            .replace(/[^a-z0-9]/g, '')                        // garde uniquement lettres + chiffres
            .trim();
            
        // Détection des colonnes via la première ligne (headers)
        const headers = rows[0].map(h => normalizeHeader(h));

        const findCol = (...keys) => {
            for (const key of keys) {
                const keyNorm = normalizeHeader(key);
                if (!keyNorm) continue;
                const idx = headers.findIndex(h => h === keyNorm);   // match exact prioritaire
                if (idx !== -1) return idx;
            }
            // 2ème passe : recherche partielle
            for (const key of keys) {
                const keyNorm = normalizeHeader(key);
                if (!keyNorm) continue;
                const idx = headers.findIndex(h => h.includes(keyNorm));
                if (idx !== -1) return idx;
            }
            return -1;
        };

        const idxName = findCol('name', 'nom', 'designation', 'désignation', 'produit', 'libelle', 'label', 'title', 'titre');
        const idxRef = findCol('ref', 'reference', 'référence', 'réf', 'sku', 'code', 'article', 'code article', 'codearticle');
        const idxPrice = findCol('prix', 'price', 'pu', 'unitprice', 'unit_price', 'tarif', 'montant', 'priceht', 'prixht', 'prix unitaire', 'prixunitaire');
        const idxUnit = findCol('unite', 'unité', 'unit', 'unite de mesure', 'uom');
        const idxCategory = findCol('categorie', 'catégorie', 'category', 'famille', 'type', 'groupe', 'rubrique');
        const idxDesc = findCol('description', 'desc', 'detail', 'détail', 'commentaire');

        if (idxName === -1 || idxPrice === -1) {
            return res.status(400).json({
                error: 'Colonnes manquantes. Le fichier doit contenir au minimum une colonne "nom" (ou "designation") et une colonne "prix".'
            });
        }

        const produits = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const name = String(row[idxName] || '').trim();
            const priceStr = String(row[idxPrice] || '').replace(',', '.').replace(/[^0-9.-]/g, '');
            const price = parseFloat(priceStr);

            if (!name || isNaN(price)) continue;

            produits.push({
                ref: idxRef !== -1 ? String(row[idxRef] || '').trim() || null : null,
                name,
                description: idxDesc !== -1 ? String(row[idxDesc] || '').trim() || null : null,
                unit: idxUnit !== -1 ? String(row[idxUnit] || '').trim() || 'u' : 'u',
                unitPrice: price,
                category: idxCategory !== -1 ? String(row[idxCategory] || '').trim() || null : null,
            });
        }

        if (produits.length === 0) {
            return res.status(400).json({ error: 'Aucun produit valide trouvé dans le fichier.' });
        }

        // Insertion en bulk
        const values = [];
        const params = [];
        produits.forEach((p, idx) => {
            const base = idx * 7;
            values.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`);
            params.push(req.user.id, p.ref, p.name, p.description, p.unit, p.unitPrice, p.category);
        });

        await pool.query(`
            INSERT INTO products (user_id, ref, name, description, unit, unit_price, category)
            VALUES ${values.join(', ')}
        `, params);

        res.json({ success: true, imported: produits.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de l\'import : ' + err.message });
    }
});

module.exports = router;