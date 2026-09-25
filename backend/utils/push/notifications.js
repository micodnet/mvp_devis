// backend/utils/push/notifications.js
// Envoi de notifications push (Web Push)

const webpush = require('web-push');
const { pool } = require('../../db');

// Configuration VAPID
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Push notifications configurées');
} else {
    console.warn('⚠️ VAPID keys manquantes — notifications push désactivées');
}

// ------------------------------------------------------------
// Envoyer une notification à tous les appareils d'un utilisateur
// ------------------------------------------------------------
async function sendNotificationToUser(userId, payload) {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return { sent: 0, errors: 0 };
    }

    const result = await pool.query(
        'SELECT * FROM push_subscriptions WHERE user_id = $1',
        [userId]
    );

    if (result.rows.length === 0) {
        return { sent: 0, errors: 0 };
    }

    let sent = 0;
    let errors = 0;
    const toDelete = [];

    for (const sub of result.rows) {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };

        try {
            await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
            sent++;
            // Mettre à jour last_used_at
            await pool.query(
                'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1',
                [sub.id]
            );
        } catch (err) {
            errors++;
            // 410 = subscription expirée, on la supprime
            if (err.statusCode === 410 || err.statusCode === 404) {
                toDelete.push(sub.id);
            } else {
                console.warn(`Push erreur (${err.statusCode}):`, err.message);
            }
        }
    }

    // Nettoyer les subscriptions mortes
    if (toDelete.length > 0) {
        await pool.query(
            'DELETE FROM push_subscriptions WHERE id = ANY($1)',
            [toDelete]
        );
        console.log(`🗑 ${toDelete.length} subscription(s) morte(s) supprimée(s)`);
    }

    return { sent, errors };
}

// ------------------------------------------------------------
// Notifications prédéfinies
// ------------------------------------------------------------
async function notifyQuoteViewed(userId, quote) {
    return sendNotificationToUser(userId, {
        title: '👁 Devis consulté',
        body: `${quote.client_name || 'Un client'} a ouvert le devis ${quote.quote_number}`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: `/?tab=history&quote=${quote.id}`,
        tag: `quote-viewed-${quote.id}`
    });
}

async function notifyQuoteSigned(userId, quote) {
    return sendNotificationToUser(userId, {
        title: '✍️ Devis signé !',
        body: `${quote.signature_signed_by || 'Un client'} a signé le devis ${quote.quote_number}`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: `/?tab=history&quote=${quote.id}`,
        tag: `quote-signed-${quote.id}`,
        requireInteraction: true
    });
}

async function notifyInvoiceOverdue(userId, invoice) {
    return sendNotificationToUser(userId, {
        title: '⚠️ Facture en retard',
        body: `La facture ${invoice.invoice_number} (${parseFloat(invoice.total).toFixed(2)} €) est en retard`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: `/?tab=invoices&invoice=${invoice.id}`,
        tag: `invoice-overdue-${invoice.id}`
    });
}

async function notifyNewChantierEvent(userId, chantier, event) {
    return sendNotificationToUser(userId, {
        title: `🏗️ ${chantier.name}`,
        body: event.message || 'Nouvel événement',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: `/?tab=chantiers&chantier=${chantier.id}`,
        tag: `chantier-${chantier.id}-${Date.now()}`
    });
}

module.exports = {
    sendNotificationToUser,
    notifyQuoteViewed,
    notifyQuoteSigned,
    notifyInvoiceOverdue,
    notifyNewChantierEvent
};