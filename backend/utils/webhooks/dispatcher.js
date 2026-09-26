// backend/utils/webhooks/dispatcher.js
// Envoi des webhooks vers les URLs configurees

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { pool } = require('../../db');

const EVENTS = {
    'quote.created': 'Devis cree',
    'quote.sent': 'Devis envoye au client',
    'quote.viewed': 'Devis consulte par le client',
    'quote.signed': 'Devis signe',
    'quote.accepted': 'Devis accepte',
    'quote.refused': 'Devis refuse',
    'invoice.created': 'Facture creee',
    'invoice.sent': 'Facture envoyee',
    'invoice.paid': 'Facture payee',
    'invoice.overdue': 'Facture en retard',
    'client.created': 'Client cree',
    'chantier.created': 'Chantier cree',
    'chantier.completed': 'Chantier termine',
    'subcontractor.assignment.completed': 'Mission sous-traitant terminee'
};

function generateSecret() {
    return crypto.randomBytes(32).toString('hex');
}

function signPayload(payload, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
}

function httpRequest(urlString, options, body) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(urlString);
        } catch (e) {
            return reject(new Error('URL invalide: ' + urlString));
        }

        const lib = parsedUrl.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        const req = lib.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'POST',
            headers: options.headers || {},
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: data.slice(0, 2000),
                    durationMs: Date.now() - startTime
                });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout apres 10 secondes'));
        });

        if (body) req.write(body);
        req.end();
    });
}

async function deliverOne(webhook, eventType, payload, attempt) {
    const delivery = {
        id: crypto.randomUUID(),
        event: eventType,
        timestamp: new Date().toISOString(),
        attempt: attempt || 1,
        data: payload
    };

    const body = JSON.stringify(delivery);
    const signature = signPayload(delivery, webhook.secret);

    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': delivery.id,
        'X-Webhook-Signature': 'sha256=' + signature,
        'X-Webhook-Attempt': String(attempt || 1),
        'User-Agent': 'DevisExpressPro-Webhook/1.0'
    };

    const startTime = Date.now();
    let responseStatus = null;
    let responseBody = null;
    let errorMessage = null;
    let success = false;

    try {
        const result = await httpRequest(webhook.url, { method: 'POST', headers }, body);
        responseStatus = result.status;
        responseBody = result.body;
        success = result.status >= 200 && result.status < 300;
    } catch (err) {
        errorMessage = err.message;
        responseStatus = 0;
    }

    const durationMs = Date.now() - startTime;

    try {
        await pool.query(`
            INSERT INTO webhook_deliveries (
                webhook_id, user_id, event_type, payload,
                response_status, response_body, duration_ms,
                success, error_message, attempt
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            webhook.id,
            webhook.user_id,
            eventType,
            JSON.stringify(delivery),
            responseStatus,
            responseBody,
            durationMs,
            success,
            errorMessage,
            attempt || 1
        ]);
    } catch (logErr) {
        console.error('Erreur log webhook delivery:', logErr.message);
    }

    return { success, status: responseStatus, durationMs, error: errorMessage };
}

async function dispatchEvent(userId, eventType, payload) {
    try {
        const result = await pool.query(`
            SELECT * FROM webhooks
            WHERE user_id = $1 AND active = TRUE
        `, [userId]);

        const matching = result.rows.filter(w => {
            const events = Array.isArray(w.events) ? w.events : [];
            return events.includes(eventType) || events.includes('*');
        });

        if (matching.length === 0) return { delivered: 0 };

        const deliveries = await Promise.allSettled(
            matching.map(webhook => deliverOne(webhook, eventType, payload, 1))
        );

        const successCount = deliveries.filter(d =>
            d.status === 'fulfilled' && d.value.success
        ).length;

        return { delivered: successCount, total: matching.length };
    } catch (err) {
        console.error('Erreur dispatchEvent:', err.message);
        return { delivered: 0, error: err.message };
    }
}

async function retryFailedDeliveries() {
    try {
        const result = await pool.query(`
            SELECT d.*, w.url, w.secret, w.active as webhook_active
            FROM webhook_deliveries d
            JOIN webhooks w ON w.id = d.webhook_id
            WHERE d.success = FALSE
              AND d.attempt < 3
              AND d.created_at > NOW() - INTERVAL '24 hours'
              AND w.active = TRUE
            ORDER BY d.created_at ASC
            LIMIT 50
        `);

        let retried = 0;
        for (const delivery of result.rows) {
            const nextAttempt = delivery.attempt + 1;
            const webhook = {
                id: delivery.webhook_id,
                user_id: delivery.user_id,
                url: delivery.url,
                secret: delivery.secret
            };

            const payload = delivery.payload;
            await deliverOne(webhook, delivery.event_type, payload.data, nextAttempt);
            retried++;
        }

        return { retried };
    } catch (err) {
        console.error('Erreur retryFailedDeliveries:', err.message);
        return { retried: 0, error: err.message };
    }
}

module.exports = {
    EVENTS,
    generateSecret,
    signPayload,
    dispatchEvent,
    retryFailedDeliveries
};