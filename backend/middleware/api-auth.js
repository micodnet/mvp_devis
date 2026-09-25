// backend/middleware/api-auth.js
// Middleware d'authentification par cle API

const { authenticateApiKey, hasScope, logApiCall, checkRateLimit } = require('../utils/api/auth');

function requireApiKey(requiredScope) {
    return async (req, res, next) => {
        const startTime = Date.now();

        const authResult = await authenticateApiKey(req);
        if (!authResult.valid) {
            await logApiCall(null, null, req, 401, Date.now() - startTime, authResult.error);
            return res.status(401).json({ error: authResult.error });
        }

        if (!hasScope(authResult.scopes, requiredScope || 'read')) {
            await logApiCall(authResult.userId, authResult.key.id, req, 403, Date.now() - startTime, 'Scope insuffisant');
            return res.status(403).json({
                error: 'Permission insuffisante. Requis : ' + requiredScope,
                yourScopes: authResult.scopes
            });
        }

        const rateLimit = await checkRateLimit(authResult.key.id, authResult.key.rate_limit_per_hour);
        if (!rateLimit.allowed) {
            await logApiCall(authResult.userId, authResult.key.id, req, 429, Date.now() - startTime, 'Rate limit');
            return res.status(429).json({
                error: rateLimit.message,
                used: rateLimit.used,
                limit: rateLimit.limit
            });
        }

        req.apiUser = {
            id: authResult.userId,
            apiKeyId: authResult.key.id,
            scopes: authResult.scopes,
            startTime
        };

        // Hook pour logger la reponse
        const originalJson = res.json.bind(res);
        res.json = function(body) {
            const duration = Date.now() - startTime;
            logApiCall(req.apiUser.id, req.apiUser.apiKeyId, req, res.statusCode, duration, null)
                .catch(err => console.warn('Erreur log:', err.message));
            return originalJson(body);
        };

        next();
    };
}

module.exports = { requireApiKey };