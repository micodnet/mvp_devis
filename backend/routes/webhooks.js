// backend/routes/webhooks.js
// Routes pour gerer les webhooks

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { EVENTS, generateSecret, dispatchEvent } = require('../utils/webhooks/dispatcher');

const router = express.Router();

// ============================================================
// GET /api/webhooks/events — Liste des evenements disponibles
// ============================================================
router.get('/events', authenticateToken, (req, res) => {
    res.json(Object.entries(EVENTS).map(([key, label]) => ({ key, label })));
});

// ============================================================
// GET /api/webhooks — Liste des webhooks
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*,
                (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) as total_deliveries,
                (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.success = TRUE) as success_count,
                (SELECT MAX(created_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id) as last_delivery_at
            FROM webhooks w
            WHERE w.user_id = $1
            ORDER BY w.created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(w => ({
            id: w.id,
            url: w.url,
            description: w.description,
            events: w.events || [],
            secret: w.secret,
            active: w.active,
            totalDeliveries: parseInt(w.total_deliveries),
            successCount: parseInt(w.success_count),
            lastDeliveryAt: w.last_delivery_at,
            createdAt: w.created_at,
            updatedAt: w.updated_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/webhooks — Creer un webhook
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { url, description, events } = req.body;

    if (!url || !url.trim()) {
        return res.status(400).json({ error: 'URL requise.' });
    }
    if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'URL invalide (doit commencer par http:// ou https://).' });
    }
    if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'Selectionnez au moins un evenement.' });
    }

    const validEvents = events.filter(e => EVENTS[e] || e === '*');
    if (validEvents.length === 0) {
        return res.status(400).json({ error: 'Aucun evenement valide.' });
    }

    try {
        const secret = generateSecret();

        const result = await pool.query(`
            INSERT INTO webhooks (user_id, url, description, events, secret)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            req.user.id,
            url.trim(),
            description || null,
            JSON.stringify(validEvents),
            secret
        ]);

        res.json({
            success: true,
            webhook: {
                id: result.rows[0].id,
                url: result.rows[0].url,
                description: result.rows[0].description,
                events: result.rows[0].events,
                secret: result.rows[0].secret,
                active: result.rows[0].active,
                createdAt: result.rows[0].created_at
            }
        });
    } catch (err) {
        console.error('Erreur create webhook:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/webhooks/:id — Modifier un webhook
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { url, description, events, active } = req.body;

    try {
        const result = await pool.query(`
            UPDATE webhooks SET
                url = COALESCE($1, url),
                description = COALESCE($2, description),
                events = COALESCE($3, events),
                active = COALESCE($4, active),
                updated_at = NOW()
            WHERE id = $5 AND user_id = $6
            RETURNING *
        `, [
            url || null,
            description !== undefined ? description : null,
            Array.isArray(events) && events.length > 0 ? JSON.stringify(events) : null,
            active !== undefined ? active : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook introuvable.' });
        }

        res.json({ success: true, webhook: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/webhooks/:id — Supprimer un webhook
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/webhooks/:id/test — Tester un webhook
// ============================================================
router.post('/:id/test', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM webhooks WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook introuvable.' });
        }

        const webhook = result.rows[0];

        const testPayload = {
            message: 'Ceci est un test de webhook depuis Devis Express Pro',
            test: true,
            webhookId: id
        };

        const { deliverOne } = require('../utils/webhooks/dispatcher');
        // deliverOne n'est pas exporte, on utilise dispatchEvent avec un faux evenement
        // Alternative : appel direct
        const crypto = require('crypto');
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');

        const delivery = {
            id: crypto.randomUUID(),
            event: 'test',
            timestamp: new Date().toISOString(),
            attempt: 1,
            data: testPayload
        };

        const body = JSON.stringify(delivery);
        const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(delivery))
            .digest('hex');

        const parsedUrl = new URL(webhook.url);
        const lib = parsedUrl.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        const testResult = await new Promise((resolve) => {
            const request = lib.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-Webhook-Event': 'test',
                    'X-Webhook-Delivery': delivery.id,
                    'X-Webhook-Signature': 'sha256=' + signature,
                    'User-Agent': 'DevisExpressPro-Webhook/1.0'
                },
                timeout: 10000
            }, (response) => {
                let data = '';
                response.on('data', chunk => { data += chunk; });
                response.on('end', () => {
                    resolve({
                        status: response.statusCode,
                        body: data.slice(0, 500),
                        durationMs: Date.now() - startTime,
                        success: response.statusCode >= 200 && response.statusCode < 300
                    });
                });
            });

            request.on('error', (err) => {
                resolve({
                    status: 0,
                    body: null,
                    durationMs: Date.now() - startTime,
                    success: false,
                    error: err.message
                });
            });

            request.on('timeout', () => {
                request.destroy();
                resolve({
                    status: 0,
                    body: null,
                    durationMs: Date.now() - startTime,
                    success: false,
                    error: 'Timeout'
                });
            });

            request.write(body);
            request.end();
        });

        try {
            await pool.query(`
                INSERT INTO webhook_deliveries (
                    webhook_id, user_id, event_type, payload,
                    response_status, response_body, duration_ms,
                    success, error_message, attempt
                )
                VALUES ($1, $2, 'test', $3, $4, $5, $6, $7, $8, 1)
            `, [
                id,
                req.user.id,
                JSON.stringify(delivery),
                testResult.status,
                testResult.body,
                testResult.durationMs,
                testResult.success,
                testResult.error || null
            ]);
        } catch (logErr) {
            console.warn('Erreur log test delivery:', logErr.message);
        }

        res.json({
            success: testResult.success,
            status: testResult.status,
            durationMs: testResult.durationMs,
            response: testResult.body,
            error: testResult.error
        });
    } catch (err) {
        console.error('Erreur test webhook:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/webhooks/:id/deliveries — Historique des livraisons
// ============================================================
router.get('/:id/deliveries', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const result = await pool.query(`
            SELECT * FROM webhook_deliveries
            WHERE webhook_id = $1 AND user_id = $2
            ORDER BY created_at DESC
            LIMIT $3
        `, [id, req.user.id, limit]);

        res.json(result.rows.map(d => ({
            id: d.id,
            eventType: d.event_type,
            payload: d.payload,
            responseStatus: d.response_status,
            responseBody: d.response_body,
            durationMs: d.duration_ms,
            success: d.success,
            errorMessage: d.error_message,
            attempt: d.attempt,
            createdAt: d.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;