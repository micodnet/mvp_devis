// backend/routes/public-verify.js
// Vérification publique d'un devis signé (sans authentification)

const express = require('express');
const { pool } = require('../db');
const { verifyQuoteIntegrity } = require('../utils/signature/eidas-signer');

const router = express.Router();

// ============================================================
// GET /api/public/verify/:token — Vérifier l'intégrité d'un devis
// ============================================================
router.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 20) {
        return res.status(400).json({ error: 'Token invalide.' });
    }

    try {
        const result = await verifyQuoteIntegrity(token);

        // Log de la vérification
        if (result.quote) {
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            await pool.query(`
                INSERT INTO signature_verifications (quote_id, token, ip_address, user_agent, result)
                VALUES ($1, $2, $3, $4, $5)
            `, [result.quote.id, token, ip, userAgent, result.valid ? 'valid' : 'invalid']);
        }

        res.json(result);
    } catch (err) {
        console.error('Erreur public verify:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;