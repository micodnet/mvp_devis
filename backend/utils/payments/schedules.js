// backend/utils/payments/schedules.js
// Gestion des plans de paiement (echeances)

const { pool } = require('../../db');

// ------------------------------------------------------------
// Cree un plan de paiement complet sur une facture
// ------------------------------------------------------------
async function createSchedule(userId, invoiceId, entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('Au moins une echeance est requise.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verifier la facture
        const invoiceResult = await client.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, userId]
        );

        if (invoiceResult.rows.length === 0) {
            throw new Error('Facture introuvable.');
        }

        const invoice = invoiceResult.rows[0];

        // Verifier qu'il n'y a pas deja un plan
        const existing = await client.query(
            'SELECT id FROM invoice_payment_schedules WHERE invoice_id = $1',
            [invoiceId]
        );

        if (existing.rows.length > 0) {
            throw new Error('Cette facture a deja un plan de paiement. Supprimez-le d\'abord.');
        }

        // Calculer la somme
        let totalScheduled = 0;
        for (const e of entries) {
            const amount = parseFloat(e.amount) || 0;
            if (amount <= 0) throw new Error('Chaque echeance doit avoir un montant positif.');
            totalScheduled += amount;
        }

        const invoiceTotal = parseFloat(invoice.total);

        // Tolerance de 0.01 EUR
        if (Math.abs(totalScheduled - invoiceTotal) > 0.01) {
            throw new Error(
                'La somme des echeances (' + totalScheduled.toFixed(2) +
                ' EUR) doit egaler le total de la facture (' + invoiceTotal.toFixed(2) + ' EUR).'
            );
        }

        // Inserer les echeances
        const inserted = [];
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const result = await client.query(`
                INSERT INTO invoice_payment_schedules (
                    user_id, invoice_id, position, label, amount, due_date, notes
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                userId,
                invoiceId,
                i + 1,
                e.label || ('Echeance ' + (i + 1)),
                parseFloat(e.amount),
                e.dueDate,
                e.notes || null
            ]);
            inserted.push(result.rows[0]);
        }

        await client.query('COMMIT');

        return inserted;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Charge le plan d'une facture
// ------------------------------------------------------------
async function getScheduleForInvoice(invoiceId, userId) {
    const result = await pool.query(`
        SELECT * FROM invoice_payment_schedules
        WHERE invoice_id = $1 AND user_id = $2
        ORDER BY position ASC
    `, [invoiceId, userId]);

    return result.rows.map(e => ({
        id: e.id,
        position: e.position,
        label: e.label,
        amount: parseFloat(e.amount),
        dueDate: e.due_date,
        amountPaid: parseFloat(e.amount_paid) || 0,
        paidAt: e.paid_at,
        paymentMethod: e.payment_method,
        status: e.status,
        notes: e.notes,
        createdAt: e.created_at
    }));
}

// ------------------------------------------------------------
// Enregistre un paiement sur une echeance
// ------------------------------------------------------------
async function payScheduleEntry(userId, entryId, amount, method, notes) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Charger l'echeance
        const entryResult = await client.query(
            'SELECT * FROM invoice_payment_schedules WHERE id = $1 AND user_id = $2',
            [entryId, userId]
        );

        if (entryResult.rows.length === 0) {
            throw new Error('Echeance introuvable.');
        }

        const entry = entryResult.rows[0];
        const currentPaid = parseFloat(entry.amount_paid) || 0;
        const newPaid = currentPaid + parseFloat(amount);
        const entryAmount = parseFloat(entry.amount);

        if (newPaid > entryAmount + 0.01) {
            throw new Error('Le montant paye depasse le montant de l\'echeance.');
        }

        const isFullyPaid = newPaid >= entryAmount - 0.01;
        const newStatus = isFullyPaid ? 'paid' : 'partial';

        // Mettre a jour l'echeance
        await client.query(`
            UPDATE invoice_payment_schedules
            SET amount_paid = $1,
                status = $2,
                paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END,
                payment_method = COALESCE($3, payment_method),
                notes = COALESCE($4, notes),
                updated_at = NOW()
            WHERE id = $5
        `, [newPaid, newStatus, method || null, notes || null, entryId]);

        // Mettre a jour la facture
        const invoiceResult = await client.query(
            'SELECT * FROM invoices WHERE id = $1',
            [entry.invoice_id]
        );

        if (invoiceResult.rows.length > 0) {
            const invoice = invoiceResult.rows[0];
            const invoicePaid = (parseFloat(invoice.amount_paid) || 0) + parseFloat(amount);
            const invoiceTotal = parseFloat(invoice.total);
            const newDue = Math.max(0, invoiceTotal - invoicePaid);
            const invoiceStatus = newDue <= 0.01 ? 'paid' : 'partial';

            await client.query(`
                UPDATE invoices
                SET amount_paid = $1,
                    amount_due = $2,
                    status = $3,
                    payment_date = NOW(),
                    payment_method = COALESCE($4, payment_method),
                    updated_at = NOW()
                WHERE id = $5
            `, [invoicePaid, newDue, invoiceStatus, method || null, entry.invoice_id]);

            // Ajouter dans invoice_payments
            await client.query(`
                INSERT INTO invoice_payments (
                    user_id, invoice_id, amount, payment_date, payment_method, notes
                )
                VALUES ($1, $2, $3, CURRENT_DATE, $4, $5)
            `, [userId, entry.invoice_id, parseFloat(amount), method || null, notes || null]);
        }

        await client.query('COMMIT');

        return {
            scheduleId: entryId,
            newStatus: newStatus,
            amountPaid: newPaid,
            isFullyPaid: isFullyPaid
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Supprime le plan de paiement d'une facture
// ------------------------------------------------------------
async function deleteSchedule(userId, invoiceId) {
    // Supprimer uniquement si aucune echeance n'a ete payee
    const checkResult = await pool.query(`
        SELECT COUNT(*) as count FROM invoice_payment_schedules
        WHERE invoice_id = $1 AND user_id = $2 AND amount_paid > 0
    `, [invoiceId, userId]);

    if (parseInt(checkResult.rows[0].count) > 0) {
        throw new Error('Impossible de supprimer : certaines echeances ont deja ete payees.');
    }

    const result = await pool.query(`
        DELETE FROM invoice_payment_schedules
        WHERE invoice_id = $1 AND user_id = $2
    `, [invoiceId, userId]);

    return result.rowCount;
}

// ------------------------------------------------------------
// Liste les echeances a venir / en retard pour un utilisateur
// ------------------------------------------------------------
async function getUpcomingSchedules(userId, days = 30) {
    const result = await pool.query(`
        SELECT s.*, i.invoice_number, i.client_name, i.currency
        FROM invoice_payment_schedules s
        JOIN invoices i ON i.id = s.invoice_id
        WHERE s.user_id = $1
          AND s.status != 'paid'
          AND s.due_date <= CURRENT_DATE + INTERVAL '1 day' * $2
        ORDER BY s.due_date ASC
    `, [userId, days]);

    return result.rows.map(r => ({
        id: r.id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        clientName: r.client_name,
        currency: r.currency || 'EUR',
        label: r.label,
        amount: parseFloat(r.amount),
        amountPaid: parseFloat(r.amount_paid) || 0,
        dueDate: r.due_date,
        status: r.status,
        isOverdue: new Date(r.due_date) < new Date()
    }));
}

module.exports = {
    createSchedule,
    getScheduleForInvoice,
    payScheduleEntry,
    deleteSchedule,
    getUpcomingSchedules
};