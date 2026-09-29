// backend/middleware/client-auth.js
// Middleware d'authentification pour le portail client

const { pool } = require('../db');
const { verifyClientJwt } = require('../utils/client-portal/helpers');

function requireClientAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentification requise.' });
    }

    const token = authHeader.substring(7).trim();
    const decoded = verifyClientJwt(token);

    if (!decoded) {
        return res.status(401).json({ error: 'Session expiree ou invalide.' });
    }

    // Verifier que le compte est toujours actif
    pool.query(
        'SELECT id, active FROM client_accounts WHERE id = $1',
        [decoded.id]
    ).then(result => {
        if (result.rows.length === 0 || !result.rows[0].active) {
            return res.status(401).json({ error: 'Compte desactive.' });
        }

        req.clientUser = {
            id: decoded.id,
            clientId: decoded.clientId,
            ownerId: decoded.ownerId,
            email: decoded.email
        };

        next();
    }).catch(err => {
        console.error('Erreur requireClientAuth:', err.message);
        res.status(500).json({ error: 'Erreur serveur.' });
    });
}

module.exports = { requireClientAuth };