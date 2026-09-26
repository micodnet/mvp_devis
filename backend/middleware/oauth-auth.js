// backend/middleware/oauth-auth.js
// Middleware d'authentification par OAuth 2.0

const { pool } = require('../db');
const { logOauthEvent } = require('../utils/oauth/helpers');

function requireOAuth(requiredScope) {
    return async (req, res, next) => {
        let token = null;

        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7).trim();
        }

        if (!token) {
            return res.status(401).json({
                error: 'invalid_token',
                error_description: 'Access token manquant.'
            });
        }

        try {
            const result = await pool.query(`
                SELECT * FROM oauth_access_tokens
                WHERE token = $1 AND revoked = FALSE
            `, [token]);

            if (result.rows.length === 0) {
                return res.status(401).json({
                    error: 'invalid_token',
                    error_description: 'Access token invalide.'
                });
            }

            const tokenRow = result.rows[0];

            if (new Date(tokenRow.expires_at) < new Date()) {
                return res.status(401).json({
                    error: 'invalid_token',
                    error_description: 'Access token expire.'
                });
            }

            const scopes = tokenRow.scopes || [];

            if (requiredScope && requiredScope !== 'read') {
                if (!scopes.includes('admin') && !scopes.includes(requiredScope)) {
                    return res.status(403).json({
                        error: 'insufficient_scope',
                        error_description: 'Scope requis : ' + requiredScope
                    });
                }
            } else if (requiredScope === 'read') {
                if (scopes.length === 0) {
                    return res.status(403).json({
                        error: 'insufficient_scope',
                        error_description: 'Aucun scope accorde.'
                    });
                }
            }

            await pool.query(
                'UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE id = $1',
                [tokenRow.id]
            ).catch(() => {});

            req.oauthUser = {
                id: tokenRow.user_id,
                clientId: tokenRow.client_id,
                scopes: scopes
            };
            req.user = { id: tokenRow.user_id };

            next();
        } catch (err) {
            console.error('Erreur requireOAuth:', err);
            res.status(500).json({
                error: 'server_error',
                error_description: 'Erreur serveur.'
            });
        }
    };
}

module.exports = { requireOAuth };