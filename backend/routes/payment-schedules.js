// backend/routes/payment-schedules.js
// Routes pour les plans de paiement (echeances)

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    createSchedule,
    getScheduleForInvoice,
    payScheduleEntry,
    deleteSchedule,
    getUpcomingSchedules
} = require('../utils/payments/schedules');

const router = express.Router();

// ============================================================
// GET /api/payment-schedules/upcoming — Echeances a venir
// ============================================================
router.get('/upcoming', authenticateToken, async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);

    try {
        const schedules = await getUpcomingSchedules(req.user.id, days);
        res.json(schedules);
    } catch (err) {
        console.error('Erreur upcoming schedules:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/payment-schedules/invoice/:invoiceId — Plan d'une facture
// ============================================================
router.get('/invoice/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const schedule = await getScheduleForInvoice(invoiceId, req.user.id);

        // Charger la facture pour verifier l'acces et afficher le total
        const invoiceResult = await pool.query(
            'SELECT id, invoice_number, total, amount_paid, amount_due, currency, status FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );

        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const invoice = invoiceResult.rows[0];

        res.json({
            invoice: {
                id: invoice.id,
                number: invoice.invoice_number,
                total: parseFloat(invoice.total),
                amountPaid: parseFloat(invoice.amount_paid) || 0,
                amountDue: parseFloat(invoice.amount_due) || parseFloat(invoice.total),
                currency: invoice.currency || 'EUR',
                status: invoice.status
            },
            schedule: schedule,
            hasSchedule: schedule.length > 0
        });
    } catch (err) {
        console.error('Erreur get schedule:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/payment-schedules/invoice/:invoiceId — Creer un plan
// ============================================================
router.post('/invoice/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    const { entries } = req.body;

    try {
        const inserted = await createSchedule(req.user.id, invoiceId, entries);
        res.json({ success: true, schedule: inserted });
    } catch (err) {
        console.error('Erreur create schedule:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// POST /api/payment-schedules/invoice/:invoiceId/generate — Plan automatique
// ============================================================
router.post('/invoice/:invoiceId/generate', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    const { installments, firstDueDays, intervalDays, firstAmount } = req.body;

    try {
        // Charger la facture
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );

        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const invoice = invoiceResult.rows[0];
        const total = parseFloat(invoice.total);

        const numInstallments = Math.max(2, Math.min(parseInt(installments) || 2, 24));
        const daysBetween = Math.max(1, parseInt(intervalDays) || 30);
        const firstDays = Math.max(0, parseInt(firstDueDays) || 0);
        const depositAmount = parseFloat(firstAmount) || 0;

        // Calculer les montants
        const entries = [];
        let remaining = total;

        for (let i = 0; i < numInstallments; i++) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + firstDays + (i * daysBetween));

            let amount;
            let label;

            if (i === 0 && depositAmount > 0) {
                amount = Math.min(depositAmount, remaining);
                label = 'Acompte';
            } else if (i === numInstallments - 1) {
                // Derniere echeance : prend le reste
                amount = remaining;
                label = 'Solde';
            } else {
                const remainingInstallments = numInstallments - i;
                amount = Math.round((remaining / remainingInstallments) * 100) / 100;
                label = 'Echeance ' + (i + 1);
            }

            remaining = Math.round((remaining - amount) * 100) / 100;

            entries.push({
                amount: amount,
                dueDate: dueDate.toISOString().slice(0, 10),
                label: label
            });
        }

        // Ajuster la derniere si necessaire (arrondis)
        if (entries.length > 0 && Math.abs(remaining) > 0.01) {
            entries[entries.length - 1].amount = Math.round((entries[entries.length - 1].amount + remaining) * 100) / 100;
        }

        const inserted = await createSchedule(req.user.id, invoiceId, entries);
        res.json({ success: true, schedule: inserted });
    } catch (err) {
        console.error('Erreur generate schedule:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// POST /api/payment-schedules/entries/:id/pay — Payer une echeance
// ============================================================
router.post('/entries/:id/pay', authenticateToken, async (req, res) => {
    const entryId = parseInt(req.params.id);
    if (!entryId) return res.status(400).json({ error: 'ID invalide.' });

    const { amount, method, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'Montant invalide.' });
    }

    try {
        const result = await payScheduleEntry(req.user.id, entryId, amount, method, notes);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Erreur pay entry:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/payment-schedules/invoice/:invoiceId — Supprimer un plan
// ============================================================
router.delete('/invoice/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const count = await deleteSchedule(req.user.id, invoiceId);
        res.json({ success: true, deleted: count });
    } catch (err) {
        console.error('Erreur delete schedule:', err);
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;