// backend/utils/stripe/checkout.js
// Gestion des paiements Stripe

const Stripe = require('stripe');
const { pool } = require('../../db');

// ------------------------------------------------------------
// Charge la config Stripe d'un utilisateur
// ------------------------------------------------------------
async function getUserStripeConfig(userId) {
    const result = await pool.query(
        'SELECT stripe_enabled, stripe_public_key, stripe_secret_key, stripe_webhook_secret FROM settings WHERE user_id = $1',
        [userId]
    );

    if (result.rows.length === 0) return null;
    const s = result.rows[0];

    if (!s.stripe_enabled) return null;
    if (!s.stripe_secret_key) return null;

    return {
        enabled: true,
        publicKey: s.stripe_public_key,
        secretKey: s.stripe_secret_key,
        webhookSecret: s.stripe_webhook_secret
    };
}

// ------------------------------------------------------------
// Cree un client Stripe pour une config
// ------------------------------------------------------------
function getStripeClient(secretKey) {
    return new Stripe(secretKey, {
        apiVersion: '2023-10-16'
    });
}

// ------------------------------------------------------------
// Cree une session Stripe Checkout pour une facture
// ------------------------------------------------------------
async function createCheckoutSessionForInvoice(userId, invoice, baseUrl) {
    const config = await getUserStripeConfig(userId);
    if (!config) {
        throw new Error('Paiement en ligne non configure.');
    }

    const stripe = getStripeClient(config.secretKey);

    const amount = parseFloat(invoice.amount_due || invoice.total);
    if (!amount || amount <= 0) {
        throw new Error('Montant invalide.');
    }

    const amountCents = Math.round(amount * 100);
    const currency = (invoice.currency || 'EUR').toLowerCase();

    // Charger la company pour l'affichage sur la page Stripe
    const settingsResult = await pool.query(
        'SELECT company_name FROM settings WHERE user_id = $1',
        [userId]
    );
    const companyName = settingsResult.rows[0]?.company_name || 'Facture';

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card', 'bancontact', 'ideal', 'sepa_debit'],
        mode: 'payment',
        customer_email: invoice.client_email || undefined,
        line_items: [{
            price_data: {
                currency: currency,
                product_data: {
                    name: 'Facture ' + invoice.invoice_number,
                    description: 'Emise par ' + companyName
                },
                unit_amount: amountCents
            },
            quantity: 1
        }],
        mode: 'payment',
        success_url: baseUrl + '/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/payment-cancel.html',
        client_reference_id: 'invoice_' + invoice.id,
        metadata: {
            invoice_id: String(invoice.id),
            user_id: String(userId),
            invoice_number: invoice.invoice_number
        }
    });

    // Enregistrer en base
    const insertResult = await pool.query(`
        INSERT INTO online_payments (
            user_id, invoice_id, amount, currency,
            stripe_session_id, stripe_customer_email, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        RETURNING id
    `, [
        userId,
        invoice.id,
        amount,
        invoice.currency || 'EUR',
        session.id,
        invoice.client_email || null
    ]);

    return {
        sessionId: session.id,
        url: session.url,
        paymentId: insertResult.rows[0].id
    };
}

// ------------------------------------------------------------
// Traite un evenement Stripe (checkout.session.completed)
// ------------------------------------------------------------
async function handleCheckoutCompleted(session) {
    const sessionId = session.id;
    const paymentIntentId = session.payment_intent;
    const amountTotal = (session.amount_total || 0) / 100;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    // Retrouver le paiement en base
    const paymentResult = await pool.query(
        'SELECT * FROM online_payments WHERE stripe_session_id = $1',
        [sessionId]
    );

    if (paymentResult.rows.length === 0) {
        console.warn('Paiement Stripe introuvable pour session', sessionId);
        return;
    }

    const payment = paymentResult.rows[0];

    // Mettre a jour le paiement
    await pool.query(`
        UPDATE online_payments
        SET status = 'paid',
            stripe_payment_intent_id = $1,
            stripe_customer_email = $2,
            payment_method = $3,
            paid_at = NOW(),
            updated_at = NOW()
        WHERE id = $4
    `, [paymentIntentId, customerEmail, paymentMethod, payment.id]);

    // Mettre a jour la facture
    if (payment.invoice_id) {
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1',
            [payment.invoice_id]
        );

        if (invoiceResult.rows.length > 0) {
            const invoice = invoiceResult.rows[0];
            const currentPaid = parseFloat(invoice.amount_paid) || 0;
            const newPaid = currentPaid + amountTotal;
            const total = parseFloat(invoice.total);
            const newDue = Math.max(0, total - newPaid);
            const newStatus = newDue <= 0.01 ? 'paid' : 'partial';

            await pool.query(`
                UPDATE invoices
                SET amount_paid = $1,
                    amount_due = $2,
                    status = $3,
                    payment_date = NOW(),
                    payment_method = 'stripe',
                    updated_at = NOW()
                WHERE id = $4
            `, [newPaid, newDue, newStatus, invoice.id]);

            // Ajouter dans la table des paiements partiels
            await pool.query(`
                INSERT INTO invoice_payments (
                    user_id, invoice_id, amount, payment_date,
                    payment_method, reference, notes
                )
                VALUES ($1, $2, $3, CURRENT_DATE, 'stripe', $4, 'Paiement en ligne via Stripe')
            `, [
                payment.user_id,
                invoice.id,
                amountTotal,
                paymentIntentId
            ]);
        }
    }

    return {
        paymentId: payment.id,
        invoiceId: payment.invoice_id,
        amount: amountTotal
    };
}

// ------------------------------------------------------------
// Traite un evenement Stripe (checkout.session.expired)
// ------------------------------------------------------------
async function handleCheckoutExpired(session) {
    await pool.query(`
        UPDATE online_payments
        SET status = 'expired',
            updated_at = NOW()
        WHERE stripe_session_id = $1
    `, [session.id]);
}

// ------------------------------------------------------------
// Liste les paiements en ligne d'un utilisateur
// ------------------------------------------------------------
async function listPayments(userId, limit = 100) {
    const result = await pool.query(`
        SELECT op.*, i.invoice_number
        FROM online_payments op
        LEFT JOIN invoices i ON i.id = op.invoice_id
        WHERE op.user_id = $1
        ORDER BY op.created_at DESC
        LIMIT $2
    `, [userId, limit]);

    return result.rows.map(p => ({
        id: p.id,
        invoiceId: p.invoice_id,
        invoiceNumber: p.invoice_number,
        amount: parseFloat(p.amount),
        currency: p.currency,
        status: p.status,
        paymentMethod: p.payment_method,
        customerEmail: p.stripe_customer_email,
        paidAt: p.paid_at,
        createdAt: p.created_at,
        errorMessage: p.error_message
    }));
}

module.exports = {
    getUserStripeConfig,
    getStripeClient,
    createCheckoutSessionForInvoice,
    handleCheckoutCompleted,
    handleCheckoutExpired,
    listPayments
};