// backend/utils/subcontractors/helpers.js
// Fonctions utilitaires pour la gestion des sous-traitants

const { pool } = require('../../db');

const ASSIGNMENT_STATUSES = {
    pending: { label: 'En attente', color: '#94a3b8' },
    in_progress: { label: 'En cours', color: '#3b82f6' },
    completed: { label: 'Termine', color: '#22c55e' },
    invoiced: { label: 'Facture', color: '#eab308' },
    paid: { label: 'Paye', color: '#16a34a' },
    cancelled: { label: 'Annule', color: '#f87171' }
};

async function logSubcontractorEvent(userId, subcontractorId, eventType, eventData) {
    // Simple : on log dans la console pour l'instant
    console.log('[Subcontractor] user=' + userId + ' sub=' + subcontractorId + ' event=' + eventType);
}

async function computeSubcontractorStats(subcontractorId, userId) {
    const result = await pool.query(`
        SELECT
            COUNT(*) as total_assignments,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'invoiced') as invoiced,
            COUNT(*) FILTER (WHERE status = 'paid') as paid,
            COALESCE(SUM(amount), 0) as total_amount,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_amount,
            COALESCE(SUM(amount) FILTER (WHERE status IN ('invoiced', 'completed')), 0) as pending_payment,
            COALESCE(SUM(actual_hours), 0) as total_hours
        FROM subcontractor_assignments
        WHERE subcontractor_id = $1 AND user_id = $2
    `, [subcontractorId, userId]);

    const r = result.rows[0];

    return {
        totalAssignments: parseInt(r.total_assignments),
        pending: parseInt(r.pending),
        inProgress: parseInt(r.in_progress),
        completed: parseInt(r.completed),
        invoiced: parseInt(r.invoiced),
        paid: parseInt(r.paid),
        totalAmount: parseFloat(r.total_amount),
        paidAmount: parseFloat(r.paid_amount),
        pendingPayment: parseFloat(r.pending_payment),
        totalHours: parseFloat(r.total_hours)
    };
}

async function checkSubcontractorAccess(subcontractorId, userId) {
    const result = await pool.query(
        'SELECT id FROM subcontractors WHERE id = $1 AND user_id = $2',
        [subcontractorId, userId]
    );
    return result.rows.length > 0;
}

async function updateAssignmentAutoStatus(assignmentId) {
    const result = await pool.query(
        'SELECT * FROM subcontractor_assignments WHERE id = $1',
        [assignmentId]
    );
    if (result.rows.length === 0) return null;

    const a = result.rows[0];
    let newStatus = a.status;

    if (a.paid_at && a.status !== 'paid') newStatus = 'paid';
    else if (a.invoice_number && !a.paid_at && a.status !== 'invoiced') newStatus = 'invoiced';
    else if (a.completed_at && !a.invoice_number && a.status !== 'completed') newStatus = 'completed';

    if (newStatus !== a.status) {
        await pool.query(
            'UPDATE subcontractor_assignments SET status = $1, updated_at = NOW() WHERE id = $2',
            [newStatus, assignmentId]
        );
        return newStatus;
    }
    return a.status;
}

module.exports = {
    ASSIGNMENT_STATUSES,
    logSubcontractorEvent,
    computeSubcontractorStats,
    checkSubcontractorAccess,
    updateAssignmentAutoStatus
};