// backend/middleware/auth.js
// ------------------------------------------------------------
// Middleware d'authentification par JWT
// Vérifie le token envoyé dans le header Authorization
// et attache l'utilisateur à req.user
// ------------------------------------------------------------

const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    // Le token est envoyé dans le header "Authorization: Bearer xxx"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, email }
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token invalide ou expiré.' });
    }
}

module.exports = { authenticateToken };