// backend/utils/oauth/helpers.js
// Fonctions utilitaires pour OAuth 2.0

const crypto = require('crypto');
const { pool } = require('../../db');

const SCOPES = {
    read: 'Lecture (devis, factures, clients, produits)',
    write: 'Ecriture (creation et modification)',
    admin: 'Acces complet'
};

const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 3600;
const AUTH_CODE_LIFETIME_SECONDS = 600;

function generateClientId() {
    return 'dc_' + crypto.randomBytes(16).toString('hex');
}

function generateClientSecret() {
    return 'ds_' + crypto.randomBytes(32).toString('hex');
}

function generateAuthCode() {
    return crypto.randomBytes(32).toString('hex');
}

function generateAccessToken() {
    return 'doa_' + crypto.randomBytes(32).toString('hex');
}

function generateRefreshToken() {
    return 'dor_' + crypto.randomBytes(32).toString('hex');
}

function hashSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}

function verifySecret(secret, hash) {
    return hashSecret(secret) === hash;
}

function verifyPKCE(codeVerifier, codeChallenge, method) {
    if (!codeChallenge) return true;
    if (method === 'S256') {
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        const base64url = hash.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        return base64url === codeChallenge;
    }
    if (method === 'plain' || !method) {
        return codeVerifier === codeChallenge;
    }
    return false;
}

async function logOauthEvent(userId, clientId, event, req, details) {
    try {
        const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
            || req?.socket?.remoteAddress
            || null;
        const userAgent = req?.headers?.['user-agent'] || null;

        await pool.query(`
            INSERT INTO oauth_logs (user_id, client_id, event, ip_address, user_agent, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId || null, clientId || null, event, ip, userAgent, details ? JSON.stringify(details) : null]);
    } catch (err) {
        console.warn('Erreur logOauthEvent:', err.message);
    }
}

async function cleanupExpiredTokens() {
    try {
        const codesResult = await pool.query(`
            DELETE FROM oauth_authorization_codes
            WHERE expires_at < NOW() OR used = TRUE
        `);
        const tokensResult = await pool.query(`
            DELETE FROM oauth_access_tokens
            WHERE refresh_expires_at < NOW() OR revoked = TRUE
        `);
        return {
            codesDeleted: codesResult.rowCount,
            tokensDeleted: tokensResult.rowCount
        };
    } catch (err) {
        console.error('Erreur cleanup:', err.message);
        return { codesDeleted: 0, tokensDeleted: 0, error: err.message };
    }
}

function getBaseUrl(req) {
    if (process.env.APP_URL) {
        return process.env.APP_URL.replace(/\/$/, '');
    }
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return protocol + '://' + host;
}

module.exports = {
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
    cleanupExpiredTokens,
    getBaseUrl
};