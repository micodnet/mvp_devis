// backend/routes/vision.js
// Routes pour l'analyse d'images

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { analyzeImage } = require('../utils/vision/analyzer');

const router = express.Router();

// Configuration Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'vision');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Format non supporte. Utilisez JPEG, PNG, WEBP ou HEIC.'));
    }
});

// ============================================================
// POST /api/vision/analyze — Analyser une image
// ============================================================
router.post('/analyze', authenticateToken, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucune image envoyee.' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const userPrompt = req.body.prompt || '';

    try {
        // Charger le catalogue produits
        const productsResult = await pool.query(
            'SELECT ref, name, unit_price, unit FROM products WHERE user_id = $1 LIMIT 100',
            [req.user.id]
        );
        const products = productsResult.rows.map(p => ({
            ref: p.ref,
            name: p.name,
            unitPrice: parseFloat(p.unit_price) || 0,
            unit: p.unit || 'u'
        }));

        // Analyser
        const result = await analyzeImage(filePath, mimeType, userPrompt, products);

        if (!result.success) {
            // Enregistrer l'echec
            await pool.query(`
                INSERT INTO image_analyses (
                    user_id, filename, original_name, mime_type, size_bytes,
                    user_prompt, provider, error_message, duration_ms
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                req.user.id,
                req.file.filename,
                req.file.originalname,
                mimeType,
                req.file.size,
                userPrompt,
                'all-failed',
                result.error,
                result.durationMs
            ]);

            return res.status(500).json({ error: result.error });
        }

        // Enregistrer l'analyse
        const insertResult = await pool.query(`
            INSERT INTO image_analyses (
                user_id, filename, original_name, mime_type, size_bytes,
                user_prompt, provider, model, result, raw_response, duration_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, created_at
        `, [
            req.user.id,
            req.file.filename,
            req.file.originalname,
            mimeType,
            req.file.size,
            userPrompt,
            result.provider,
            result.model,
            JSON.stringify(result.data),
            result.rawResponse,
            result.durationMs
        ]);

        res.json({
            success: true,
            analysisId: insertResult.rows[0].id,
            imageUrl: '/uploads/vision/' + req.file.filename,
            provider: result.provider,
            model: result.model,
            durationMs: result.durationMs,
            data: result.data
        });
    } catch (err) {
        console.error('Erreur analyse image:', err);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/vision/history — Historique des analyses
// ============================================================
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const result = await pool.query(`
            SELECT id, filename, original_name, user_prompt, provider, model,
                   result, duration_ms, error_message, converted_quote_id, created_at
            FROM image_analyses
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [req.user.id, limit]);

        res.json(result.rows.map(r => ({
            id: r.id,
            imageUrl: '/uploads/vision/' + r.filename,
            originalName: r.original_name,
            userPrompt: r.user_prompt,
            provider: r.provider,
            model: r.model,
            result: r.result,
            durationMs: r.duration_ms,
            errorMessage: r.error_message,
            convertedQuoteId: r.converted_quote_id,
            createdAt: r.created_at
        })));
    } catch (err) {
        console.error('Erreur history analyses:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/vision/:id — Detail d'une analyse
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM image_analyses WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Analyse introuvable.' });
        }

        const r = result.rows[0];
        res.json({
            id: r.id,
            imageUrl: '/uploads/vision/' + r.filename,
            originalName: r.original_name,
            userPrompt: r.user_prompt,
            provider: r.provider,
            model: r.model,
            result: r.result,
            durationMs: r.duration_ms,
            convertedQuoteId: r.converted_quote_id,
            createdAt: r.created_at
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/vision/:id/convert-to-quote — Convertir en devis brouillon
// ============================================================
router.post('/:id/convert-to-quote', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { items, clientName, clientEmail, vatRegime } = req.body;

    try {
        // Charger l'analyse
        const analysisResult = await pool.query(
            'SELECT * FROM image_analyses WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (analysisResult.rows.length === 0) {
            return res.status(404).json({ error: 'Analyse introuvable.' });
        }

        const analysis = analysisResult.rows[0];

        if (analysis.converted_quote_id) {
            return res.status(400).json({ error: 'Cette analyse a deja ete convertie en devis.' });
        }

        // Determiner les articles a utiliser
        let finalItems = [];

        if (Array.isArray(items) && items.length > 0) {
            // L'utilisateur a modifie les articles
            finalItems = items.map(it => ({
                ref: it.ref || null,
                name: it.name || 'Article',
                qty: parseFloat(it.qty) || 1,
                unitPrice: parseFloat(it.unitPrice) || 0
            }));
        } else if (analysis.result && Array.isArray(analysis.result.materials)) {
            // Utiliser les articles extraits par l'IA
            finalItems = analysis.result.materials.map(m => ({
                ref: m.ref || null,
                name: m.name || 'Article',
                qty: parseFloat(m.estimatedQty) || 1,
                unitPrice: parseFloat(m.unitPrice) || 0
            }));
        }

        if (finalItems.length === 0) {
            return res.status(400).json({ error: 'Aucun article a convertir.' });
        }

        // Charger les settings pour la TVA
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};
        const finalVatRegime = vatRegime || settings.vat_regime || 'franchise';
        const vatRate = parseFloat(settings.vat_rate) || 21;

        // Calculer les totaux
        let subtotal = 0;
        const formattedItems = [];

        for (const it of finalItems) {
            const total = Math.round(it.qty * it.unitPrice * 100) / 100;
            subtotal += total;

            formattedItems.push({
                ref: it.ref || 'IMG-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
                name: it.name,
                qty: it.qty,
                unitPrice: it.unitPrice,
                total: total
            });
        }

        subtotal = Math.round(subtotal * 100) / 100;
        const vatAmount = finalVatRegime === 'assujetti'
            ? Math.round(subtotal * (vatRate / 100) * 100) / 100
            : 0;
        const total = Math.round((subtotal + vatAmount) * 100) / 100;

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

        // Creer le devis
        const insertResult = await pool.query(`
            INSERT INTO quotes (
                user_id, quote_number, issue_date, valid_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_name, client_email, currency, exchange_rate
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, 'EUR', 1.0)
            RETURNING id
        `, [
            req.user.id,
            quoteNumber,
            issueDate,
            validDate,
            subtotal,
            vatAmount,
            total,
            finalVatRegime,
            JSON.stringify(formattedItems),
            clientName || 'Client image',
            clientEmail || null
        ]);

        const quoteId = insertResult.rows[0].id;

        // Marquer l'analyse comme convertie
        await pool.query(
            'UPDATE image_analyses SET converted_quote_id = $1 WHERE id = $2',
            [quoteId, id]
        );

        res.json({
            success: true,
            quoteId,
            quoteNumber,
            total
        });
    } catch (err) {
        console.error('Erreur convert-to-quote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/vision/:id — Supprimer une analyse
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT filename FROM image_analyses WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Analyse introuvable.' });
        }

        // Supprimer le fichier
        const filePath = path.join(__dirname, '..', 'uploads', 'vision', result.rows[0].filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Supprimer en base
        await pool.query(
            'DELETE FROM image_analyses WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;