// backend/utils/api/auth.js
// Authentification par cle API

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../../db');

const SCOPES = {
    read: 'Lecture seule (devis, factures, clients, produits)',
    write: 'Lecture + ecriture (creation et modification)',
    admin: 'Acces complet (gestion des cles, suppression)'
};

function generateApiKey() {
    const prefix = 'dsk_';
    const randomPart = crypto.randomBytes(24).toString('hex');
    const fullKey = prefix + randomPart;
    return {
        fullKey,
        prefix: prefix + randomPart.slice(0, 12),
        hash: crypto.createHash('sha256').update(fullKey).digest('hex')
    };
}

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

async function authenticateApiKey(req) {
    // Chercher la cle dans le header Authorization
    let apiKey = null;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7).trim();
    }

    // Fallback : header X-API-Key
    if (!apiKey && req.headers['x-api-key']) {
        apiKey = req.headers['x-api-key'].trim();
    }

    if (!apiKey || !apiKey.startsWith('dsk_')) {
        return { valid: false, error: 'Cle API manquante ou invalide.' };
    }

    const keyHash = hashKey(apiKey);

    const result = await pool.query(`
        SELECT * FROM api_keys
        WHERE key_hash = $1 AND active = TRUE
    `, [keyHash]);

    if (result.rows.length === 0) {
        return { valid: false, error: 'Cle API inconnue ou revoquee.' };
    }

    const key = result.rows[0];

    if (key.expires_at && new Date(key.expires_at) < new Date()) {
        return { valid: false, error: 'Cle API expiree.' };
    }

    // Mettre a jour last_used_at (async, non bloquant)
    pool.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
        [key.id]
    ).catch(err => console.warn('Erreur update last_used_at:', err.message));

    return {
        valid: true,
        key,
        userId: key.user_id,
        scopes: key.scopes || ['read']
    };
}

function hasScope(scopes, required) {
    if (!scopes || !Array.isArray(scopes)) return false;
    if (scopes.includes('admin')) return true;
    if (scopes.includes(required)) return true;
    if (required === 'read' && (scopes.includes('write') || scopes.includes('admin'))) return true;
    return false;
}

async function logApiCall(userId, apiKeyId, req, statusCode, durationMs, errorMessage) {
    try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        await pool.query(`
            INSERT INTO api_logs (user_id, api_key_id, method, endpoint, status_code, ip_address, user_agent, duration_ms, error_message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            userId,
            apiKeyId || null,
            req.method,
            req.originalUrl || req.path,
            statusCode,
            ip,
            userAgent,
            durationMs,
            errorMessage || null
        ]);
    } catch (err) {
        console.warn('Erreur logApiCall:', err.message);
    }
}

async function checkRateLimit(apiKeyId, limitPerHour) {
    if (!limitPerHour || limitPerHour <= 0) return { allowed: true };

    const result = await pool.query(`
        SELECT COUNT(*) as count FROM api_logs
        WHERE api_key_id = $1
          AND created_at > NOW() - INTERVAL '1 hour'
    `, [apiKeyId]);

    const count = parseInt(result.rows[0].count);
    if (count >= limitPerHour) {
        return {
            allowed: false,
            message: 'Limite de ' + limitPerHour + ' requetes par heure atteinte.',
            used: count,
            limit: limitPerHour
        };
    }

    return { allowed: true, used: count, limit: limitPerHour };
}

module.exports = {
    SCOPES,
    generateApiKey,
    hashKey,
    authenticateApiKey,
    hasScope,
    logApiCall,
    checkRateLimit
};