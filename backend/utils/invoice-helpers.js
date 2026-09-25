// backend/utils/invoice-helpers.js
// Fonctions utilitaires pour la facturation avancée

const { pool } = require('../db');

// ------------------------------------------------------------
// Génère un numéro de facture unique par exercice fiscal
// Format : FAC-2026-0001 ou AV-2026-0001 (avoir) ou DEP-2026-0001 (acompte)
// ------------------------------------------------------------
async function generateInvoiceNumber(userId, invoiceType = 'invoice') {
    const year = new Date().getFullYear();
    const prefix = invoiceType === 'credit_note' ? 'AV' :
                   invoiceType === 'deposit' ? 'DEP' :
                   invoiceType === 'final' ? 'FIN' : 'FAC';

    // Chercher le dernier numéro pour cette année et ce préfixe
    const result = await pool.query(`
        SELECT invoice_number 
        FROM invoices 
        WHERE user_id = $1 
          AND invoice_number LIKE $2
          AND EXTRACT(YEAR FROM created_at) = $3
        ORDER BY id DESC 
        LIMIT 1
    `, [userId, `${prefix}-${year}-%`, year]);

    let nextNumber = 1;
    if (result.rows.length > 0) {
        const match = result.rows[0].invoice_number.match(/-(\d+)$/);
        if (match) nextNumber = parseInt(match[1]) + 1;
    }

    return `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// ------------------------------------------------------------
// Recalcule les totaux d'une facture
// ------------------------------------------------------------
function computeTotals(items, vatRegime = 'franchise', vatRate = 21, discountPercent = 0) {
    let subtotal = 0;
    const itemsFormatted = [];

    for (const item of items) {
        const qty = parseFloat(item.qty) || 1;
        const unitPrice = parseFloat(item.unitPrice || item.unit_price) || 0;
        let total = qty * unitPrice;

        // Appliquer remise ligne
        if (item.discountPercent) {
            total = total * (1 - parseFloat(item.discountPercent) / 100);
        }

        subtotal += total;

        itemsFormatted.push({
            ref: item.ref || 'EXT',
            name: item.name || 'Article',
            qty,
            unitPrice,
            discountPercent: parseFloat(item.discountPercent) || 0,
            total: Math.round(total * 100) / 100
        });
    }

    // Appliquer remise globale
    if (discountPercent > 0) {
        subtotal = subtotal * (1 - discountPercent / 100);
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const vatAmount = vatRegime === 'assujetti' ? Math.round(subtotal * (vatRate / 100) * 100) / 100 : 0;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    return { items: itemsFormatted, subtotal, vatAmount, total };
}

// ------------------------------------------------------------
// Calcule le montant d'un acompte
// ------------------------------------------------------------
function computeDeposit(subtotal, depositPercent) {
    return Math.round(subtotal * (depositPercent / 100) * 100) / 100;
}

// ------------------------------------------------------------
// Recalcule l'état de paiement d'une facture
// ------------------------------------------------------------
async function updateInvoicePaymentState(invoiceId) {
    // Somme des paiements
    const paymentsResult = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM invoice_payments WHERE invoice_id = $1',
        [invoiceId]
    );
    const amountPaid = parseFloat(paymentsResult.rows[0].total_paid);

    // Facture
    const invoiceResult = await pool.query(
        'SELECT total FROM invoices WHERE id = $1',
        [invoiceId]
    );
    if (invoiceResult.rows.length === 0) return null;

    const total = parseFloat(invoiceResult.rows[0].total);
    const amountDue = Math.round((total - amountPaid) * 100) / 100;

    // Statut
    let status = 'sent';
    if (amountPaid >= total - 0.01) {
        status = 'paid';
    } else if (amountPaid > 0) {
        status = 'partial';
    } else if (new Date() > new Date(invoiceResult.rows[0].due_date)) {
        status = 'overdue';
    }

    // Mettre à jour
    await pool.query(`
        UPDATE invoices 
        SET amount_paid = $1, 
            amount_due = $2, 
            status = $3,
            updated_at = NOW()
        WHERE id = $4
    `, [amountPaid, amountDue, status, invoiceId]);

    return { amountPaid, amountDue, status };
}

// ------------------------------------------------------------
// Génère le CSV d'export comptable
// ------------------------------------------------------------
function generateAccountingCSV(invoices, companyName) {
    const headers = [
        'N° facture', 'Type', 'Date émission', 'Date échéance', 'Client',
        'N° TVA client', 'Sous-total HT', 'TVA', 'Total TTC',
        'Montant payé', 'Montant dû', 'Statut', 'Mode paiement', 'Date paiement'
    ];

    const rows = invoices.map(inv => [
        inv.invoice_number || '',
        inv.invoice_type === 'credit_note' ? 'Avoir' :
            inv.invoice_type === 'deposit' ? 'Acompte' :
            inv.invoice_type === 'final' ? 'Solde' : 'Facture',
        inv.issue_date || '',
        inv.due_date || '',
        (inv.client_name || '').replace(/"/g, '""'),
        inv.client_vat || '',
        (parseFloat(inv.subtotal) || 0).toFixed(2).replace('.', ','),
        (parseFloat(inv.vat_amount) || 0).toFixed(2).replace('.', ','),
        (parseFloat(inv.total) || 0).toFixed(2).replace('.', ','),
        (parseFloat(inv.amount_paid) || 0).toFixed(2).replace('.', ','),
        (parseFloat(inv.amount_due) || parseFloat(inv.total) || 0).toFixed(2).replace('.', ','),
        inv.status || '',
        inv.payment_method || '',
        inv.payment_date ? new Date(inv.payment_date).toISOString().slice(0, 10) : ''
    ]);

    const csv = [
        `Export comptable - ${companyName || ''} - ${new Date().toLocaleDateString('fr-FR')}`,
        '',
        headers.map(h => `"${h}"`).join(';'),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n');

    return csv;
}

// ------------------------------------------------------------
// Détecte les factures à relancer
// ------------------------------------------------------------
async function findInvoicesToRemind(userId) {
    // Charger les paramètres de relance
    const settingsResult = await pool.query(
        'SELECT * FROM reminder_settings WHERE user_id = $1',
        [userId]
    );
    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].enabled) {
        return [];
    }
    const settings = settingsResult.rows[0];

    // Trouver les factures en retard non payées
    const invoicesResult = await pool.query(`
        SELECT 
            i.*,
            COALESCE((
                SELECT COUNT(*) 
                FROM payment_reminders pr 
                WHERE pr.invoice_id = i.id
            ), 0) AS reminder_count,
            (
                SELECT MAX(sent_at) 
                FROM payment_reminders pr 
                WHERE pr.invoice_id = i.id
            ) AS last_reminder_at
        FROM invoices i
        WHERE i.user_id = $1
          AND i.status IN ('sent', 'partial', 'overdue')
          AND i.due_date < CURRENT_DATE
          AND COALESCE(i.amount_due, i.total) > 0.01
        ORDER BY i.due_date ASC
    `, [userId]);

    const toRemind = [];
    const now = new Date();

    for (const inv of invoicesResult.rows) {
        const dueDate = new Date(inv.due_date);
        const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
        const reminderCount = parseInt(inv.reminder_count) || 0;

        // Pas plus de max_reminders
        if (reminderCount >= settings.max_reminders) continue;

        // Premier rappel
        if (reminderCount === 0 && daysOverdue >= settings.days_before_first) {
            toRemind.push({ invoice: inv, level: 1, daysOverdue });
            continue;
        }

        // Rappels suivants
        if (reminderCount > 0 && inv.last_reminder_at) {
            const lastReminder = new Date(inv.last_reminder_at);
            const daysSinceLast = Math.floor((now - lastReminder) / (1000 * 60 * 60 * 24));
            if (daysSinceLast >= settings.days_between_reminders) {
                toRemind.push({ 
                    invoice: inv, 
                    level: reminderCount + 1, 
                    daysOverdue 
                });
            }
        }
    }

    return toRemind;
}

module.exports = {
    generateInvoiceNumber,
    computeTotals,
    computeDeposit,
    updateInvoicePaymentState,
    generateAccountingCSV,
    findInvoicesToRemind
};