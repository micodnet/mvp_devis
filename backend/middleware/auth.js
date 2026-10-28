// ------------------------------------------------------------
// Middleware d'authentification par JWT
// ⚡ Mult-utilisateurs : req.user.id = ID du COMPTE (owner)
//    req.user.userId = ID de l'utilisateur réellement connecté
//    req.user.role   = owner | admin | member
// ------------------------------------------------------------

const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    // const header = req.headers.authorization || "";
    // const token = header.startsWith("Bearer ") ? header.slice(7) : null;


    if (!token) {
        return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Pour les anciens tokens (avant multi-users) : account_id = id
        const accountId = decoded.account_id || decoded.id;

        req.user = {
            id: accountId,           // ← Utilisé par toutes les routes existantes (data)
            userId: decoded.id,      // ← ID de la personne connectée (pour team)
            //tenantId: payload.tenantId,
            email: decoded.email,
            role: decoded.role || 'owner'
        };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token invalide ou expiré.' });
    }
}

// Vérifie que l'utilisateur a un rôle autorisé
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Permissions insuffisantes.' });
        }
        next();
    };
}

module.exports = { authenticateToken, requireRole };