// backend/routes/signature.js
// Routes pour la signature électronique renforcée

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    signQuote,
    verifyQuoteIntegrity,
    generateSignatureCertificate,
    logAuditEvent
} = require('../utils/signature/eidas-signer');

const router = express.Router();

// ============================================================
// POST /api/signature/quotes/:id/sign — Signer un devis
// ============================================================
router.post('/quotes/:id/sign', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    const { method, signedBy, signatureData, accepted } = req.body;

    // Validation
    if (!['checkbox', 'draw'].includes(method)) {
        return res.status(400).json({ error: 'Méthode de signature invalide.' });
    }
    if (!signedBy || !signedBy.trim()) {
        return res.status(400).json({ error: 'Le nom du signataire est requis.' });
    }
    if (method === 'checkbox' && !accepted) {
        return res.status(400).json({ error: 'Vous devez accepter les conditions.' });
    }
    if (method === 'draw' && (!signatureData || signatureData.length < 100)) {
        return res.status(400).json({ error: 'La signature est vide.' });
    }

    try {
        // Vérifier que le devis appartient à l'utilisateur
        const quoteCheck = await pool.query(
            'SELECT id FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );
        if (quoteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const result = await signQuote(quoteId, req.user.id, {
            method, signedBy, signatureData, accepted
        }, req);

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Erreur signQuote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/signature/quotes/:id/verify — Vérifier l'intégrité
// ============================================================
router.get('/quotes/:id/verify', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Vérifier l'appartenance
        const quoteCheck = await pool.query(
            'SELECT id FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );
        if (quoteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const result = await verifyQuoteIntegrity(quoteId);
        res.json(result);
    } catch (err) {
        console.error('Erreur verifyQuote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/signature/quotes/:id/certificate — Certificat de signature
// ============================================================
router.get('/quotes/:id/certificate', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const certificate = await generateSignatureCertificate(quoteId, req.user.id);

        // Log audit
        await logAuditEvent(req.user.id, quoteId, 'certificate_downloaded', {}, req);

        res.json({ success: true, certificate });
    } catch (err) {
        console.error('Erreur certificate:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/signature/quotes/:id/audit — Audit trail complet
// ============================================================
router.get('/quotes/:id/audit', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            SELECT * FROM signature_audit
            WHERE quote_id = $1 AND user_id = $2
            ORDER BY created_at ASC
        `, [quoteId, req.user.id]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;