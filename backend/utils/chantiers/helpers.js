// backend/utils/chantiers/helpers.js
// Fonctions utilitaires pour la gestion des chantiers

const { pool } = require('../../db');

// ------------------------------------------------------------
// Enregistre un événement dans la timeline d'un chantier
// ------------------------------------------------------------
async function logChantierEvent(userId, chantierId, eventType, eventData = {}) {
    try {
        await pool.query(`
            INSERT INTO chantier_events (user_id, chantier_id, event_type, event_data)
            VALUES ($1, $2, $3, $4)
        `, [userId, chantierId, eventType, JSON.stringify(eventData)]);
    } catch (err) {
        console.error('Erreur logChantierEvent:', err.message);
    }
}

// ------------------------------------------------------------
// Calcule les statistiques d'un chantier (progression, CA)
// ------------------------------------------------------------
async function computeChantierStats(chantierId) {
    const [quotesResult, invoicesResult] = await Promise.all([
        pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
                COUNT(*) FILTER (WHERE status = 'refused') as refused,
                COALESCE(SUM(total), 0) as total_value,
                COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
            FROM quotes
            WHERE chantier_id = $1
        `, [chantierId]),
        
        pool.query(`
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(total), 0) as total_value,
                COALESCE(SUM(amount_paid), 0) as paid_value,
                COALESCE(SUM(amount_due), 0) as due_value
            FROM invoices
            WHERE chantier_id = $1 AND invoice_type != 'credit_note'
        `, [chantierId])
    ]);

    const q = quotesResult.rows[0];
    const i = invoicesResult.rows[0];

    const totalQuotes = parseInt(q.total) || 0;
    const acceptedQuotes = parseInt(q.accepted) || 0;
    const conversionRate = totalQuotes > 0 
        ? Math.round((acceptedQuotes / totalQuotes) * 100) 
        : 0;

    const acceptedValue = parseFloat(q.accepted_value) || 0;
    const invoicedValue = parseFloat(i.total_value) || 0;
    const paidValue = parseFloat(i.paid_value) || 0;
    const dueValue = parseFloat(i.due_value) || 0;

    // Progression basée sur les devis acceptés vs total
    const progression = totalQuotes > 0 
        ? Math.round((acceptedQuotes / totalQuotes) * 100) 
        : 0;

    return {
        quotes: {
            total: totalQuotes,
            accepted: acceptedQuotes,
            refused: parseInt(q.refused) || 0,
            totalValue: parseFloat(q.total_value) || 0,
            acceptedValue
        },
        invoices: {
            total: parseInt(i.total) || 0,
            invoicedValue,
            paidValue,
            dueValue
        },
        conversionRate,
        progression,
        remainingToInvoice: Math.max(0, acceptedValue - invoicedValue)
    };
}

// ------------------------------------------------------------
// Génère la timeline complète d'un chantier
// ------------------------------------------------------------
async function getChantierTimeline(chantierId, userId) {
    const result = await pool.query(`
        SELECT * FROM chantier_events
        WHERE chantier_id = $1 AND user_id = $2
        ORDER BY created_at DESC
        LIMIT 100
    `, [chantierId, userId]);

    return result.rows.map(row => ({
        id: row.id,
        type: row.event_type,
        data: row.event_data,
        date: row.created_at
    }));
}

// ------------------------------------------------------------
// Vérifie que l'utilisateur a accès au chantier
// ------------------------------------------------------------
async function checkChantierAccess(chantierId, userId) {
    const result = await pool.query(
        'SELECT id FROM chantiers WHERE id = $1 AND user_id = $2',
        [chantierId, userId]
    );
    return result.rows.length > 0;
}

module.exports = {
    logChantierEvent,
    computeChantierStats,
    getChantierTimeline,
    checkChantierAccess
};