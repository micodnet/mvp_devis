// backend/routes/stripe-webhook.js
// Webhook Stripe pour les paiements en ligne
// Endpoint : POST /api/stripe-webhook/online

const express = require('express');
const { pool } = require('../db');
const {
    getStripeClient,
    handleCheckoutCompleted,
    handleCheckoutExpired
} = require('../utils/stripe/checkout');

const router = express.Router();

// ============================================================
// POST /api/stripe-webhook/online
// Recoit les evenements Stripe pour les paiements en ligne
// ============================================================
router.post('/online', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    if (!sig) {
        return res.status(400).json({ error: 'Signature Stripe manquante.' });
    }

    let event = null;
    let secretKey = null;
    let webhookSecret = null;

    // Recuperer la config Stripe : on essaie toutes les configs actives
    // (car on ne sait pas a quel utilisateur appartient l'evenement avant de le lire)
    try {
        const configsResult = await pool.query(`
            SELECT user_id, stripe_secret_key, stripe_webhook_secret
            FROM settings
            WHERE stripe_enabled = TRUE
              AND stripe_secret_key IS NOT NULL
              AND stripe_webhook_secret IS NOT NULL
        `);

        // Essayer chaque config pour valider la signature
        for (const config of configsResult.rows) {
            try {
                const stripe = getStripeClient(config.stripe_secret_key);
                event = stripe.webhooks.constructEvent(req.body, sig, config.stripe_webhook_secret);
                secretKey = config.stripe_secret_key;
                webhookSecret = config.stripe_webhook_secret;
                break;
            } catch (e) {
                // Continuer avec la config suivante
            }
        }

        if (!event) {
            console.warn('Webhook Stripe : aucune config ne correspond a la signature.');
            return res.status(400).json({ error: 'Signature invalide.' });
        }
    } catch (err) {
        console.error('Erreur construction evenement Stripe:', err);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }

    // Logger l'evenement
    try {
        const userIdResult = await pool.query(`
            SELECT user_id FROM online_payments WHERE stripe_session_id = $1
        `, [event.data.object.id]);

        const userId = userIdResult.rows[0]?.user_id || null;

        await pool.query(`
            INSERT INTO stripe_events (user_id, event_id, event_type, payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_id) DO NOTHING
        `, [userId, event.id, event.type, JSON.stringify(event.data.object)]);
    } catch (logErr) {
        console.warn('Erreur log stripe event:', logErr.message);
    }

    // Traiter l'evenement
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const result = await handleCheckoutCompleted(session);
                console.log('Paiement Stripe recu :', result);
                break;
            }

            case 'checkout.session.expired': {
                const session = event.data.object;
                await handleCheckoutExpired(session);
                break;
            }

            default:
                // Ignorer les autres types
                break;
        }

        // Marquer comme traite
        await pool.query(
            'UPDATE stripe_events SET processed = TRUE WHERE event_id = $1',
            [event.id]
        );

        res.json({ received: true });
    } catch (err) {
        console.error('Erreur traitement evenement Stripe:', err);

        try {
            await pool.query(
                'UPDATE stripe_events SET error_message = $1 WHERE event_id = $2',
                [err.message, event.id]
            );
        } catch (logErr) {
            console.warn('Erreur log:', logErr.message);
        }

        res.status(500).json({ error: err.message });
    }
});

module.exports = router;