// backend/routes/oauth.js
// Serveur OAuth 2.0

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    SCOPES,
    ACCESS_TOKEN_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_SECONDS,
    AUTH_CODE_LIFETIME_SECONDS,
    generateClientId,
    generateClientSecret,
    generateAuthCode,
    generateAccessToken,
    generateRefreshToken,
    hashSecret,
    verifySecret,
    verifyPKCE,
    logOauthEvent,
    getBaseUrl
} = require('../utils/oauth/helpers');

const router = express.Router();

// ============================================================
// GET /api/oauth/scopes — Liste des scopes
// ============================================================
router.get('/scopes', (req, res) => {
    res.json(Object.entries(SCOPES).map(([key, label]) => ({ key, label })));
});

// ============================================================
// POST /api/oauth/clients — Creer une application OAuth
// ============================================================
router.post('/clients', authenticateToken, async (req, res) => {
    const { name, description, redirectUris, scopes, isPublic } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom est requis.' });
    }

    const validScopes = Array.isArray(scopes) && scopes.length > 0
        ? scopes.filter(s => SCOPES[s])
        : ['read'];

    if (validScopes.length === 0) {
        return res.status(400).json({ error: 'Aucun scope valide.' });
    }

    const uris = Array.isArray(redirectUris)
        ? redirectUris.filter(u => typeof u === 'string' && u.startsWith('http'))
        : [];

    if (!isPublic && uris.length === 0) {
        return res.status(400).json({ error: 'Au moins une URL de redirection est requise pour une app confidentielle.' });
    }

    try {
        const clientId = generateClientId();
        const clientSecret = isPublic ? null : generateClientSecret();

        const result = await pool.query(`
            INSERT INTO oauth_clients (user_id, client_id, client_secret, name, description, redirect_uris, scopes, is_public)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            req.user.id,
            clientId,
            clientSecret ? hashSecret(clientSecret) : null,
            name.trim(),
            description || null,
            JSON.stringify(uris),
            JSON.stringify(validScopes),
            isPublic === true
        ]);

        await logOauthEvent(req.user.id, clientId, 'client_created', req, { name, scopes: validScopes });

        res.json({
            success: true,
            client: {
                id: result.rows[0].id,
                clientId,
                clientSecret: clientSecret,
                name: result.rows[0].name,
                description: result.rows[0].description,
                redirectUris: result.rows[0].redirect_uris,
                scopes: result.rows[0].scopes,
                isPublic: result.rows[0].is_public,
                createdAt: result.rows[0].created_at
            },
            warning: clientSecret
                ? 'Copiez le client_secret maintenant. Il ne sera plus jamais affiche.'
                : null
        });
    } catch (err) {
        console.error('Erreur create oauth client:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/oauth/clients — Liste des applications OAuth
// ============================================================
router.get('/clients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, client_id, name, description, redirect_uris, scopes, is_public, active, created_at, updated_at
            FROM oauth_clients
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(c => ({
            id: c.id,
            clientId: c.client_id,
            name: c.name,
            description: c.description,
            redirectUris: c.redirect_uris || [],
            scopes: c.scopes || [],
            isPublic: c.is_public,
            active: c.active,
            createdAt: c.created_at,
            updatedAt: c.updated_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/oauth/clients/:id — Modifier
// ============================================================
router.put('/clients/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { name, description, redirectUris, scopes, active } = req.body;

    try {
        const result = await pool.query(`
            UPDATE oauth_clients SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                redirect_uris = COALESCE($3, redirect_uris),
                scopes = COALESCE($4, scopes),
                active = COALESCE($5, active),
                updated_at = NOW()
            WHERE id = $6 AND user_id = $7
            RETURNING *
        `, [
            name || null,
            description !== undefined ? description : null,
            Array.isArray(redirectUris) ? JSON.stringify(redirectUris) : null,
            Array.isArray(scopes) ? JSON.stringify(scopes) : null,
            active !== undefined ? active : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Application introuvable.' });
        }

        res.json({ success: true, client: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/oauth/clients/:id — Supprimer
// ============================================================
router.delete('/clients/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM oauth_clients WHERE id = $1 AND user_id = $2 RETURNING id, client_id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Application introuvable.' });
        }

        await pool.query(
            'UPDATE oauth_access_tokens SET revoked = TRUE WHERE client_id = $1',
            [result.rows[0].client_id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/oauth/tokens — Jetons actifs
// ============================================================
router.get('/tokens', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.id, t.client_id, c.name as client_name,
                   t.scopes, t.expires_at, t.refresh_expires_at, t.last_used_at, t.created_at
            FROM oauth_access_tokens t
            LEFT JOIN oauth_clients c ON c.client_id = t.client_id
            WHERE t.user_id = $1 AND t.revoked = FALSE AND t.refresh_expires_at > NOW()
            ORDER BY t.created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(t => ({
            id: t.id,
            clientId: t.client_id,
            clientName: t.client_name,
            scopes: t.scopes || [],
            expiresAt: t.expires_at,
            refreshExpiresAt: t.refresh_expires_at,
            lastUsedAt: t.last_used_at,
            createdAt: t.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/oauth/tokens/:id/revoke — Revoquer un jeton
// ============================================================
router.post('/tokens/:id/revoke', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'UPDATE oauth_access_tokens SET revoked = TRUE WHERE id = $1 AND user_id = $2 RETURNING client_id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jeton introuvable.' });
        }

        await logOauthEvent(req.user.id, result.rows[0].client_id, 'token_revoked', req, {});

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/oauth/authorize — Etape 1 du flux OAuth
// ============================================================
router.get('/authorize', authenticateToken, async (req, res) => {
    const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

    if (!client_id || !redirect_uri) {
        return res.status(400).json({ error: 'client_id et redirect_uri requis.' });
    }

    if (response_type !== 'code') {
        return res.status(400).json({ error: 'response_type doit etre code.' });
    }

    try {
        const clientResult = await pool.query(
            'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = TRUE',
            [client_id]
        );

        if (clientResult.rows.length === 0) {
            return res.status(400).json({ error: 'Application inconnue ou inactive.' });
        }

        const client = clientResult.rows[0];
        const redirectUris = client.redirect_uris || [];

        if (!redirectUris.includes(redirect_uri)) {
            return res.status(400).json({ error: 'redirect_uri non autorisee.' });
        }

        const requestedScopes = scope
            ? scope.split(' ').filter(s => SCOPES[s])
            : (client.scopes || ['read']);

        // HTML de consentement
        const scopesHtml = requestedScopes.map(s =>
            '<li style="padding:6px 0;border-bottom:1px solid #1e2a41;"><strong style="color:#f97316;">' + s + '</strong> — ' + (SCOPES[s] || '') + '</li>'
        ).join('');

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Autorisation OAuth - Devis Express Pro</title>
<style>
body { background:#0b1120; color:#e2e8f0; font-family:system-ui,-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; }
.card { background:#161f32; border:1px solid #2a3a55; border-radius:20px; padding:32px; max-width:480px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.5); }
h1 { color:#fff; font-size:22px; margin:0 0 8px; }
p { color:#cbd5e1; font-size:14px; line-height:1.6; }
.app-name { color:#f97316; font-weight:700; }
ul { list-style:none; padding:0; margin:16px 0; }
button { width:100%; padding:14px; border-radius:60px; border:none; font-weight:700; font-size:15px; cursor:pointer; margin-top:8px; }
.btn-accept { background:#f97316; color:#0b1120; }
.btn-accept:hover { background:#ea580c; }
.btn-cancel { background:#1a253b; border:1px solid #2a3a55; color:#94a3b8; margin-top:8px; }
.btn-cancel:hover { background:#24324b; color:#e2e8f0; }
.notice { background:#0b1120; border:1px solid #1e2a41; border-radius:10px; padding:12px 16px; font-size:12px; color:#94a3b8; margin-top:20px; }
</style>
</head>
<body>
<div class="card">
<h1>Autorisation demandee</h1>
<p>L'application <span class="app-name">${client.name}</span> souhaite acceder a votre compte Devis Express Pro.</p>
<p style="margin-top:16px;">Voici les permissions demandees :</p>
<ul>${scopesHtml}</ul>
<form method="POST" action="/api/oauth/authorize/confirm">
<input type="hidden" name="client_id" value="${client_id}">
<input type="hidden" name="redirect_uri" value="${redirect_uri}">
<input type="hidden" name="scope" value="${requestedScopes.join(' ')}">
<input type="hidden" name="state" value="${state || ''}">
<input type="hidden" name="code_challenge" value="${code_challenge || ''}">
<input type="hidden" name="code_challenge_method" value="${code_challenge_method || ''}">
<button type="submit" name="action" value="accept" class="btn-accept">Autoriser</button>
<button type="submit" name="action" value="deny" class="btn-cancel">Refuser</button>
</form>
<div class="notice">Vous pouvez revoquer cet acces a tout moment depuis l'onglet OAuth de Devis Express Pro.</div>
</div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        console.error('Erreur oauth authorize:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/oauth/authorize/confirm — Validation
// ============================================================
router.post('/authorize/confirm', authenticateToken, express.urlencoded({ extended: true }), async (req, res) => {
    const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action } = req.body;

    try {
        const clientResult = await pool.query(
            'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = TRUE',
            [client_id]
        );

        if (clientResult.rows.length === 0) {
            return res.status(400).send('Application inconnue.');
        }

        const client = clientResult.rows[0];
        const redirectUris = client.redirect_uris || [];

        if (!redirectUris.includes(redirect_uri)) {
            return res.status(400).send('redirect_uri non autorisee.');
        }

        // Construire l'URL de redirection
        const url = new URL(redirect_uri);

        if (action === 'deny') {
            url.searchParams.set('error', 'access_denied');
            if (state) url.searchParams.set('state', state);
            await logOauthEvent(req.user.id, client_id, 'authorization_denied', req, {});
            return res.redirect(url.toString());
        }

        // Accordee
        const code = generateAuthCode();
        const expiresAt = new Date(Date.now() + AUTH_CODE_LIFETIME_SECONDS * 1000);
        const requestedScopes = scope
            ? scope.split(' ').filter(s => SCOPES[s])
            : (client.scopes || ['read']);

        await pool.query(`
            INSERT INTO oauth_authorization_codes (
                code, client_id, user_id, redirect_uri, scopes,
                code_challenge, code_challenge_method, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            code,
            client_id,
            req.user.id,
            redirect_uri,
            JSON.stringify(requestedScopes),
            code_challenge || null,
            code_challenge_method || null,
            expiresAt
        ]);

        await logOauthEvent(req.user.id, client_id, 'authorization_granted', req, { scopes: requestedScopes });

        url.searchParams.set('code', code);
        if (state) url.searchParams.set('state', state);

        res.redirect(url.toString());
    } catch (err) {
        console.error('Erreur confirm authorize:', err);
        res.status(500).send('Erreur serveur.');
    }
});

// ============================================================
// POST /api/oauth/token — Echange code contre token
// ============================================================
router.post('/token', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    const {
        grant_type,
        code,
        redirect_uri,
        client_id,
        client_secret,
        code_verifier,
        refresh_token
    } = req.body;

    // Authentification client
    let client = null;
    const authHeader = req.headers['authorization'];

    let basicClientId = null;
    let basicClientSecret = null;

    if (authHeader && authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
        const parts = decoded.split(':');
        basicClientId = parts[0];
        basicClientSecret = parts[1];
    }

    const finalClientId = basicClientId || client_id;
    const finalClientSecret = basicClientSecret || client_secret;

    if (!finalClientId) {
        return res.status(400).json({ error: 'invalid_client', error_description: 'client_id requis.' });
    }

    try {
        const clientResult = await pool.query(
            'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = TRUE',
            [finalClientId]
        );

        if (clientResult.rows.length === 0) {
            return res.status(401).json({ error: 'invalid_client', error_description: 'Application inconnue.' });
        }

        client = clientResult.rows[0];

        if (!client.is_public) {
            if (!finalClientSecret || !verifySecret(finalClientSecret, client.client_secret)) {
                await logOauthEvent(null, finalClientId, 'invalid_client_secret', req, {});
                return res.status(401).json({ error: 'invalid_client', error_description: 'client_secret invalide.' });
            }
        }

        // Grant type : authorization_code
        if (grant_type === 'authorization_code') {
            if (!code || !redirect_uri) {
                return res.status(400).json({ error: 'invalid_request', error_description: 'code et redirect_uri requis.' });
            }

            const codeResult = await pool.query(`
                SELECT * FROM oauth_authorization_codes
                WHERE code = $1 AND used = FALSE
            `, [code]);

            if (codeResult.rows.length === 0) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'Code invalide ou deja utilise.' });
            }

            const authCode = codeResult.rows[0];

            if (new Date(authCode.expires_at) < new Date()) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expire.' });
            }

            if (authCode.client_id !== finalClientId) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'Code non associe a ce client.' });
            }

            if (authCode.redirect_uri !== redirect_uri) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri differente.' });
            }

            if (authCode.code_challenge) {
                if (!code_verifier || !verifyPKCE(code_verifier, authCode.code_challenge, authCode.code_challenge_method)) {
                    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification echouee.' });
                }
            }

            // Marquer le code comme utilise
            await pool.query('UPDATE oauth_authorization_codes SET used = TRUE WHERE id = $1', [authCode.id]);

            // Generer les tokens
            const accessToken = generateAccessToken();
            const refreshToken = generateRefreshToken();
            const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_LIFETIME_SECONDS * 1000);

            await pool.query(`
                INSERT INTO oauth_access_tokens (
                    token, refresh_token, client_id, user_id, scopes,
                    expires_at, refresh_expires_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                accessToken,
                refreshToken,
                finalClientId,
                authCode.user_id,
                JSON.stringify(authCode.scopes),
                accessExpiresAt,
                refreshExpiresAt
            ]);

            await logOauthEvent(authCode.user_id, finalClientId, 'token_issued', req, { grant_type: 'authorization_code' });

            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
                refresh_token: refreshToken,
                scope: (authCode.scopes || []).join(' ')
            });
        }

        // Grant type : refresh_token
        if (grant_type === 'refresh_token') {
            if (!refresh_token) {
                return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token requis.' });
            }

            const tokenResult = await pool.query(`
                SELECT * FROM oauth_access_tokens
                WHERE refresh_token = $1 AND revoked = FALSE
            `, [refresh_token]);

            if (tokenResult.rows.length === 0) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token invalide.' });
            }

            const oldToken = tokenResult.rows[0];

            if (new Date(oldToken.refresh_expires_at) < new Date()) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token expire.' });
            }

            if (oldToken.client_id !== finalClientId) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token non associe a ce client.' });
            }

            // Revoquer l'ancien
            await pool.query('UPDATE oauth_access_tokens SET revoked = TRUE WHERE id = $1', [oldToken.id]);

            // Generer de nouveaux tokens
            const newAccessToken = generateAccessToken();
            const newRefreshToken = generateRefreshToken();
            const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_LIFETIME_SECONDS * 1000);

            await pool.query(`
                INSERT INTO oauth_access_tokens (
                    token, refresh_token, client_id, user_id, scopes,
                    expires_at, refresh_expires_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                newAccessToken,
                newRefreshToken,
                finalClientId,
                oldToken.user_id,
                JSON.stringify(oldToken.scopes),
                accessExpiresAt,
                refreshExpiresAt
            ]);

            await logOauthEvent(oldToken.user_id, finalClientId, 'token_refreshed', req, {});

            return res.json({
                access_token: newAccessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
                refresh_token: newRefreshToken,
                scope: (oldToken.scopes || []).join(' ')
            });
        }

        // Grant type : client_credentials
        if (grant_type === 'client_credentials') {
            if (client.is_public) {
                return res.status(400).json({ error: 'unauthorized_client', error_description: 'client_credentials non autorise pour les clients publics.' });
            }

            if (!client.user_id) {
                return res.status(400).json({ error: 'unauthorized_client', error_description: 'Ce client n\'est pas associe a un utilisateur.' });
            }

            const accessToken = generateAccessToken();
            const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000);
            const refreshExpiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000);
            const refreshToken = generateRefreshToken();

            await pool.query(`
                INSERT INTO oauth_access_tokens (
                    token, refresh_token, client_id, user_id, scopes,
                    expires_at, refresh_expires_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                accessToken,
                refreshToken,
                finalClientId,
                client.user_id,
                JSON.stringify(client.scopes),
                accessExpiresAt,
                refreshExpiresAt
            ]);

            await logOauthEvent(client.user_id, finalClientId, 'token_issued', req, { grant_type: 'client_credentials' });

            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
                scope: (client.scopes || []).join(' ')
            });
        }

        return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'grant_type non supporte.' });
    } catch (err) {
        console.error('Erreur oauth token:', err);
        res.status(500).json({ error: 'server_error', error_description: err.message });
    }
});

// ============================================================
// POST /api/oauth/revoke — Revoquer un token
// ============================================================
router.post('/revoke', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token requis.' });

    try {
        const result = await pool.query(
            'SELECT * FROM oauth_access_tokens WHERE token = $1 OR refresh_token = $1',
            [token]
        );

        if (result.rows.length > 0) {
            await pool.query(
                'UPDATE oauth_access_tokens SET revoked = TRUE WHERE id = $1',
                [result.rows[0].id]
            );
            await logOauthEvent(result.rows[0].user_id, result.rows[0].client_id, 'token_revoked', req, {});
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur revoke:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/oauth/introspect — Verifier un token
// ============================================================
router.post('/introspect', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ active: false });

    try {
        const result = await pool.query(`
            SELECT * FROM oauth_access_tokens
            WHERE token = $1 AND revoked = FALSE
        `, [token]);

        if (result.rows.length === 0) {
            return res.json({ active: false });
        }

        const row = result.rows[0];

        if (new Date(row.expires_at) < new Date()) {
            return res.json({ active: false });
        }

        res.json({
            active: true,
            client_id: row.client_id,
            scope: (row.scopes || []).join(' '),
            expires_at: Math.floor(new Date(row.expires_at).getTime() / 1000),
            token_type: 'Bearer'
        });
    } catch (err) {
        res.json({ active: false });
    }
});

// ============================================================
// GET /api/oauth/logs — Historique OAuth
// ============================================================
router.get('/logs', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const result = await pool.query(`
            SELECT * FROM oauth_logs
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [req.user.id, limit]);

        res.json(result.rows.map(l => ({
            id: l.id,
            event: l.event,
            clientId: l.client_id,
            ipAddress: l.ip_address,
            details: l.details,
            createdAt: l.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;