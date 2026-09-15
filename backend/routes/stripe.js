// Routes Stripe : checkout, portail client, statut abonnement, webhook

const express = require('express');
const Stripe = require('stripe');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Correspondance plan -> price ID (depuis les variables d'environnement)
const PLAN_PRICES = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    entreprise: process.env.STRIPE_PRICE_ENTREPRISE,
};

// ============================================================
// POST /api/stripe/create-checkout-session
// Crée une session de paiement Stripe pour un plan
// ============================================================
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
    try {
        const { plan } = req.body;
        if (!PLAN_PRICES[plan]) {
            return res.status(400).json({ error: 'Plan invalide.' });
        }

        const userResult = await pool.query(
            'SELECT id, email, stripe_customer_id FROM users WHERE id = $1',
            [req.user.id]
        );
        const user = userResult.rows[0];

        let customerId = user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { userId: user.id }
            });
            customerId = customer.id;
            await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: PLAN_PRICES[plan], quantity: 1 }],
            success_url: `${baseUrl}/?checkout=success`,
            cancel_url: `${baseUrl}/?checkout=cancel`,
            metadata: { userId: user.id, plan }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Erreur create-checkout-session:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stripe/create-portal-session
// Renvoie l'URL du portail Stripe pour gérer son abonnement
// ============================================================
router.post('/create-portal-session', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query(
            'SELECT stripe_customer_id FROM users WHERE id = $1',
            [req.user.id]
        );
        const customerId = userResult.rows[0]?.stripe_customer_id;
        if (!customerId) {
            return res.status(400).json({ error: 'Aucun abonnement trouvé.' });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${baseUrl}/`,
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Erreur create-portal-session:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stripe/subscription
// Renvoie le statut d'abonnement de l'utilisateur
// ============================================================
router.get('/subscription', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT subscription_plan, subscription_status, subscription_end_date FROM users WHERE id = $1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({
            plan: user.subscription_plan || 'free',
            status: user.subscription_status || 'inactive',
            endDate: user.subscription_end_date
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// WEBHOOK : appelé par Stripe quand un événement arrive
// Note : nécessite le body RAW (pas parsé), donc monté séparément dans server.js
// ============================================================
async function stripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Signature webhook invalide:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📩 Stripe event: ${event.type}`);

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.metadata?.userId;
                const plan = session.metadata?.plan;
                const subscriptionId = session.subscription;
                const customerId = session.customer;

                if (userId && plan) {
                    // Récupérer la fin de période
                    let endDate = null;
                    try {
                        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                        const ts = subscription.current_period_end
                            || (subscription.items?.data?.[0]?.current_period_end);
                        if (ts) endDate = new Date(ts * 1000);
                    } catch (e) {
                        console.warn('Impossible de récupérer endDate:', e.message);
                    }

                    await pool.query(`
                        UPDATE users
                        SET subscription_plan = $1,
                            subscription_status = 'active',
                            subscription_end_date = $2,
                            stripe_customer_id = $3
                        WHERE id = $4
                    `, [plan, endDate, customerId, userId]);
                    console.log(`✅ User ${userId} activé sur le plan ${plan}`);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const customerId = subscription.customer;
                const status = subscription.status;
                let endDate = null;
                const ts = subscription.current_period_end
                    || (subscription.items?.data?.[0]?.current_period_end);
                if (ts) endDate = new Date(ts * 1000);

                await pool.query(`
                    UPDATE users
                    SET subscription_status = $1, subscription_end_date = $2
                    WHERE stripe_customer_id = $3
                `, [status, endDate, customerId]);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const customerId = subscription.customer;

                await pool.query(`
                    UPDATE users
                    SET subscription_plan = 'free', subscription_status = 'inactive', subscription_end_date = NULL
                    WHERE stripe_customer_id = $1
                `, [customerId]);
                console.log(`❌ Abonnement annulé pour customer ${customerId}`);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const customerId = invoice.customer;

                await pool.query(`
                    UPDATE users SET subscription_status = 'past_due'
                    WHERE stripe_customer_id = $1
                `, [customerId]);
                break;
            }
        }
        res.json({ received: true });
    } catch (err) {
        console.error('Erreur traitement webhook:', err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { router, stripeWebhook };