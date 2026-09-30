// backend/utils/proactive/detector.js
// Moteur de detection des situations a suggerer

const { pool } = require('../../db');

// ------------------------------------------------------------
// Charge les parametres proactifs d'un utilisateur
// ------------------------------------------------------------
async function getProactiveSettings(userId) {
    const result = await pool.query(
        'SELECT * FROM proactive_settings WHERE user_id = $1',
        [userId]
    );

    if (result.rows.length === 0) {
        // Creer les parametres par defaut
        await pool.query(
            'INSERT INTO proactive_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [userId]
        );
        return {
            enabled: true,
            dormantQuoteDays: 14,
            upcomingPaymentDays: 3,
            lowStockEnabled: true,
            overdueInvoiceEnabled: true,
            dormantQuoteEnabled: true,
            upcomingPaymentEnabled: true
        };
    }

    const s = result.rows[0];
    return {
        enabled: s.enabled !== false,
        dormantQuoteDays: parseInt(s.dormant_quote_days) || 14,
        upcomingPaymentDays: parseInt(s.upcoming_payment_days) || 3,
        lowStockEnabled: s.low_stock_enabled !== false,
        overdueInvoiceEnabled: s.overdue_invoice_enabled !== false,
        dormantQuoteEnabled: s.dormant_quote_enabled !== false,
        upcomingPaymentEnabled: s.upcoming_payment_enabled !== false
    };
}

// ------------------------------------------------------------
// Cree une suggestion (ou remplace une existante du meme type/contexte)
// ------------------------------------------------------------
async function upsertSuggestion(userId, suggestion) {
    // Verifier si une suggestion identique existe deja et est active
    let query = 'SELECT id FROM assistant_suggestions WHERE user_id = $1 AND suggestion_type = $2 AND status = \'active\'';
    const params = [userId, suggestion.suggestionType];

    if (suggestion.relatedQuoteId) {
        params.push(suggestion.relatedQuoteId);
        query += ' AND related_quote_id = $' + params.length;
    } else if (suggestion.relatedInvoiceId) {
        params.push(suggestion.relatedInvoiceId);
        query += ' AND related_invoice_id = $' + params.length;
    } else if (suggestion.relatedChantierId) {
        params.push(suggestion.relatedChantierId);
        query += ' AND related_chantier_id = $' + params.length;
    }

    query += ' LIMIT 1';

    const existing = await pool.query(query, params);

    if (existing.rows.length > 0) {
        // Mettre a jour
        await pool.query(`
            UPDATE assistant_suggestions
            SET title = $1,
                message = $2,
                action_type = $3,
                action_payload = $4,
                priority = $5,
                created_at = NOW()
            WHERE id = $6
        `, [
            suggestion.title,
            suggestion.message,
            suggestion.actionType || null,
            suggestion.actionPayload ? JSON.stringify(suggestion.actionPayload) : null,
            suggestion.priority || 5,
            existing.rows[0].id
        ]);
        return existing.rows[0].id;
    }

    // Creer
    const result = await pool.query(`
        INSERT INTO assistant_suggestions (
            user_id, suggestion_type, title, message, action_type, action_payload,
            related_quote_id, related_invoice_id, related_chantier_id, priority, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
    `, [
        userId,
        suggestion.suggestionType,
        suggestion.title,
        suggestion.message,
        suggestion.actionType || null,
        suggestion.actionPayload ? JSON.stringify(suggestion.actionPayload) : null,
        suggestion.relatedQuoteId || null,
        suggestion.relatedInvoiceId || null,
        suggestion.relatedChantierId || null,
        suggestion.priority || 5,
        suggestion.expiresAt || null
    ]);

    return result.rows[0].id;
}

// ------------------------------------------------------------
// DETECTION 1 : Factures en retard
// ------------------------------------------------------------
async function detectOverdueInvoices(userId) {
    const result = await pool.query(`
        SELECT id, invoice_number, client_name, total, amount_due, due_date,
                (CURRENT_DATE - due_date)::int as days_overdue
        FROM invoices
        WHERE user_id = $1
          AND status IN ('sent', 'partial', 'overdue')
          AND due_date < CURRENT_DATE
          AND COALESCE(amount_due, total) > 0.01
        ORDER BY due_date ASC
    `, [userId]);

    if (result.rows.length === 0) {
        return [];
    }

    const totalOverdue = result.rows.reduce((s, r) => s + parseFloat(r.amount_due || r.total), 0);
    const oldest = result.rows[0];
    const count = result.rows.length;

    // Message adapte
    let title, message;
    if (count === 1) {
        title = 'Facture en retard';
        message = 'La facture ' + oldest.invoice_number + ' (' + parseFloat(oldest.amount_due || oldest.total).toFixed(2) + ' EUR) est en retard depuis ' + oldest.days_overdue + ' jours.';
    } else {
        title = count + ' factures en retard';
        message = count + ' factures sont en retard, pour un total de ' + totalOverdue.toFixed(2) + ' EUR. La plus ancienne : ' + oldest.invoice_number + ' (' + oldest.days_overdue + ' jours).';
    }

    await upsertSuggestion(userId, {
        suggestionType: 'overdue_invoices',
        title: title,
        message: message,
        actionType: 'send_reminders',
        actionPayload: { invoiceIds: result.rows.map(r => r.id) },
        priority: 8,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    return [{
        type: 'overdue_invoices',
        count: count,
        totalAmount: totalOverdue
    }];
}

// ------------------------------------------------------------
// DETECTION 2 : Devis dormants (envoyes mais non ouverts ou non repondu)
// ------------------------------------------------------------
async function detectDormantQuotes(userId, dormantDays = 14) {
    const result = await pool.query(`
        SELECT id, quote_number, client_name, total,
               (CURRENT_DATE - sent_to_client_at::date)::int as days_since_sent,
               client_viewed_at
        FROM quotes
        WHERE user_id = $1
          AND status = 'sent'
          AND sent_to_client_at IS NOT NULL
          AND sent_to_client_at < NOW() - INTERVAL '1 day' * $2
          AND (signature_signed_at IS NULL)
        ORDER BY sent_to_client_at ASC
        LIMIT 5
    `, [userId, dormantDays]);

    if (result.rows.length === 0) return [];

    const suggestions = [];
    for (const q of result.rows) {
        const viewed = q.client_viewed_at ? 'Le client l\'a consulte mais n\'a pas encore signe.' : 'Le client ne l\'a jamais ouvert.';
        await upsertSuggestion(userId, {
            suggestionType: 'dormant_quote',
            title: 'Devis dormant : ' + q.quote_number,
            message: 'Devis ' + q.quote_number + ' envoye il y a ' + q.days_since_sent + ' jours. ' + viewed + ' Montant : ' + parseFloat(q.total).toFixed(2) + ' EUR.',
            actionType: 'follow_up_quote',
            actionPayload: { quoteId: q.id },
            relatedQuoteId: q.id,
            priority: 6,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });
        suggestions.push({
            type: 'dormant_quote',
            quoteId: q.id,
            quoteNumber: q.quote_number
        });
    }

    return suggestions;
}

// ------------------------------------------------------------
// DETECTION 3 : Echeances de paiement a venir
// ------------------------------------------------------------
async function detectUpcomingPayments(userId, daysAhead = 3) {
    const result = await pool.query(`
        SELECT s.*, i.invoice_number, i.client_name, i.currency,
               (s.due_date - CURRENT_DATE)::int as days_until
        FROM invoice_payment_schedules s
        JOIN invoices i ON i.id = s.invoice_id
        WHERE s.user_id = $1
          AND s.status != 'paid'
          AND s.due_date >= CURRENT_DATE
          AND s.due_date <= CURRENT_DATE + INTERVAL '1 day' * $2
        ORDER BY s.due_date ASC
    `, [userId, daysAhead]);

    if (result.rows.length === 0) return [];

    const totalAmount = result.rows.reduce((s, r) => s + parseFloat(r.amount) - parseFloat(r.amount_paid || 0), 0);
    const first = result.rows[0];

    await upsertSuggestion(userId, {
        suggestionType: 'upcoming_payments',
        title: result.rows.length + ' echeance(s) a venir',
        message: result.rows.length + ' echeance(s) de paiement dans les ' + daysAhead + ' prochains jours, pour un total de ' + totalAmount.toFixed(2) + ' EUR. Premiere : ' + first.invoice_number + ' (' + parseFloat(first.amount).toFixed(2) + ' EUR dans ' + first.days_until + ' jour(s)).',
        actionType: 'view_schedules',
        actionPayload: { scheduleIds: result.rows.map(r => r.id) },
        priority: 7,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    });

    return [{
        type: 'upcoming_payments',
        count: result.rows.length,
        totalAmount: totalAmount
    }];
}

// ------------------------------------------------------------
// DETECTION 4 : Produits sous le seuil d'alerte
// ------------------------------------------------------------
async function detectLowStock(userId) {
    const result = await pool.query(`
        SELECT p.id, p.ref, p.name, p.stock_quantity, p.stock_alert_threshold, p.supplier_id
        FROM products p
        WHERE p.user_id = $1
          AND p.track_stock = TRUE
          AND p.stock_quantity <= p.stock_alert_threshold
          AND p.supplier_id IS NOT NULL
    `, [userId]);

    if (result.rows.length === 0) return [];

    const count = result.rows.length;
    const names = result.rows.slice(0, 3).map(r => r.name).join(', ');

    await upsertSuggestion(userId, {
        suggestionType: 'low_stock',
        title: count + ' produit(s) en alerte de stock',
        message: count + ' produit(s) sont sous le seuil d\'alerte : ' + names + (count > 3 ? '...' : '') + '. Voulez-vous generer les bons de commande ?',
        actionType: 'generate_purchase_orders',
        actionPayload: { productIds: result.rows.map(r => r.id) },
        priority: 7,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    return [{
        type: 'low_stock',
        count: count
    }];
}

// ------------------------------------------------------------
// Point d'entree : lance toutes les detections pour un utilisateur
// ------------------------------------------------------------
async function runDetectionForUser(userId) {
    const settings = await getProactiveSettings(userId);

    if (!settings.enabled) {
        return { skipped: true, reason: 'disabled' };
    }

    const detected = [];

    try {
        if (settings.overdueInvoiceEnabled) {
            const r = await detectOverdueInvoices(userId);
            detected.push(...r);
        }
    } catch (err) {
        console.warn('Erreur detectOverdueInvoices:', err.message);
    }

    try {
        if (settings.dormantQuoteEnabled) {
            const r = await detectDormantQuotes(userId, settings.dormantQuoteDays);
            detected.push(...r);
        }
    } catch (err) {
        console.warn('Erreur detectDormantQuotes:', err.message);
    }

    try {
        if (settings.upcomingPaymentEnabled) {
            const r = await detectUpcomingPayments(userId, settings.upcomingPaymentDays);
            detected.push(...r);
        }
    } catch (err) {
        console.warn('Erreur detectUpcomingPayments:', err.message);
    }

    try {
        if (settings.lowStockEnabled) {
            const r = await detectLowStock(userId);
            detected.push(...r);
        }
    } catch (err) {
        console.warn('Erreur detectLowStock:', err.message);
    }

    // Nettoyer les suggestions expirees
    await pool.query(`
        UPDATE assistant_suggestions
        SET status = 'expired'
        WHERE user_id = $1 AND status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
    `, [userId]);

    return { detected: detected.length, details: detected };
}

// ------------------------------------------------------------
// Lance la detection pour tous les utilisateurs actifs
// ------------------------------------------------------------
async function runDetectionForAllUsers() {
    const usersResult = await pool.query('SELECT id FROM users LIMIT 10000');
    let totalDetected = 0;
    let errors = 0;

    for (const user of usersResult.rows) {
        try {
            const result = await runDetectionForUser(user.id);
            if (result.detected) totalDetected += result.detected;
        } catch (err) {
            console.warn('Erreur detection user ' + user.id + ':', err.message);
            errors++;
        }
    }

    return { users: usersResult.rows.length, detected: totalDetected, errors: errors };
}

module.exports = {
    getProactiveSettings,
    upsertSuggestion,
    runDetectionForUser,
    runDetectionForAllUsers
};