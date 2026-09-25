// backend/routes/push.js
// Routes pour les notifications push

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendNotificationToUser } = require('../utils/push/notifications');

const router = express.Router();

// ============================================================
// GET /api/push/vapid-key — Récupérer la clé publique VAPID
// ============================================================
router.get('/vapid-key', (req, res) => {
    res.json({
        publicKey: process.env.VAPID_PUBLIC_KEY || null
    });
});

// ============================================================
// POST /api/push/subscribe — S'abonner aux notifications
// ============================================================
router.post('/subscribe', authenticateToken, async (req, res) => {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: 'Subscription invalide.' });
    }

    const userAgent = req.headers['user-agent'] || null;
    const deviceLabel = /mobile/i.test(userAgent) ? 'Mobile' : 'Desktop';

    try {
        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (endpoint) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                last_used_at = NOW()
        `, [req.user.id, endpoint, keys.p256dh, keys.auth, userAgent, deviceLabel]);

        console.log(`📱 Push subscription ajoutée pour user ${req.user.id}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur push subscribe:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/push/unsubscribe — Se désabonner
// ============================================================
router.delete('/unsubscribe', authenticateToken, async (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint requis.' });

    try {
        await pool.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
            [endpoint, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/push/subscriptions — Liste des appareils abonnés
// ============================================================
router.get('/subscriptions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, device_label, user_agent, created_at, last_used_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/push/test — Envoyer une notification de test
// ============================================================
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const result = await sendNotificationToUser(req.user.id, {
            title: '🔔 Test de notification',
            body: 'Si vous voyez ce message, les notifications fonctionnent !',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-96x96.png',
            url: '/',
            tag: 'test'
        });

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Erreur push test:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;