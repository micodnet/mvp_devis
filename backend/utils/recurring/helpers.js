// backend/utils/recurring/helpers.js
// Logique metier des factures recurrentes

const { pool } = require('../../db');

const FREQUENCIES = {
    monthly: { label: 'Mensuelle', months: 1 },
    quarterly: { label: 'Trimestrielle', months: 3 },
    semiannual: { label: 'Semestrielle', months: 6 },
    yearly: { label: 'Annuelle', months: 12 }
};

const STATUSES = {
    active: { label: 'Active', color: '#22c55e' },
    paused: { label: 'En pause', color: '#eab308' },
    completed: { label: 'Terminee', color: '#64748b' },
    cancelled: { label: 'Annulee', color: '#f87171' }
};

// ------------------------------------------------------------
// Calcule la prochaine date d'emission
// ------------------------------------------------------------
function computeNextIssueDate(rule, fromDate) {
    const freq = FREQUENCIES[rule.frequency];
    if (!freq) return null;

    const base = fromDate ? new Date(fromDate) : new Date(rule.start_date);
    const months = freq.months;

    // Avancer d'un cycle
    let next = new Date(base);
    next.setMonth(next.getMonth() + months);

    // Ajuster au jour choisi dans le mois
    if (rule.day_of_period && rule.day_of_period > 0) {
        const desiredDay = rule.day_of_period;
        const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(desiredDay, lastDayOfMonth));
    }

    return next;
}

// ------------------------------------------------------------
// Determine si une regle doit etre emise aujourd'hui
// ------------------------------------------------------------
function shouldIssueToday(rule, today) {
    if (rule.status !== 'active') return false;

    const todayStr = today.toISOString().slice(0, 10);
    const nextStr = rule.next_issue_date ? rule.next_issue_date.toISOString().slice(0, 10) : null;

    if (!nextStr) return false;

    // Si la date d'emission est aujourd'hui ou avant (en retard)
    return nextStr <= todayStr;
}

// ------------------------------------------------------------
// Genere une facture a partir d'une regle
// ------------------------------------------------------------
async function generateInvoiceFromRule(rule) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Charger les settings du user pour la numerotation
        const settingsResult = await client.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [rule.user_id]
        );
        const settings = settingsResult.rows[0] || {};

        // Generer le numero de facture
        const counterResult = await client.query(
            'SELECT last_number FROM counters WHERE user_id = $1',
            [rule.user_id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await client.query(
                'UPDATE counters SET last_number = $1 WHERE user_id = $2',
                [newNumber, rule.user_id]
            );
        } else {
            await client.query(
                'INSERT INTO counters (user_id, last_number) VALUES ($1, 1)',
                [rule.user_id]
            );
        }

        const prefix = settings.invoice_prefix || 'FAC';
        const year = new Date().getFullYear();
        const invoiceNumber = prefix + '-' + year + '-' + String(newNumber).padStart(4, '0');

        // Dates
        const issueDate = new Date().toISOString().slice(0, 10);
        const paymentTerms = rule.payment_terms || settings.payment_terms || 30;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + paymentTerms);

        // Items
        const items = Array.isArray(rule.items) ? rule.items : [];

        // Inserer la facture
        const insertResult = await client.query(`
            INSERT INTO invoices (
                user_id, invoice_number, invoice_type, issue_date, due_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_id, client_name, client_address, client_vat, client_email,
                currency, amount_due, notes
            )
            VALUES ($1, $2, 'invoice', $3, $4, $5, $6, $7, $8, 'draft', $9,
                    $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id, invoice_number
        `, [
            rule.user_id,
            invoiceNumber,
            issueDate,
            dueDate.toISOString().slice(0, 10),
            rule.subtotal,
            rule.vat_amount,
            rule.total,
            rule.vat_regime || 'franchise',
            JSON.stringify(items),
            rule.client_id,
            rule.client_name,
            rule.client_address,
            rule.client_vat,
            rule.client_email,
            rule.currency || 'EUR',
            rule.total,
            'Facture recurrente : ' + rule.name
        ]);

        const invoiceId = insertResult.rows[0].id;

        // Calculer la prochaine date
        const nextDate = computeNextIssueDate(rule, rule.next_issue_date);
        const newCount = (rule.occurrences_count || 0) + 1;

        // Determiner le nouveau statut
        let newStatus = rule.status;
        let finalNextDate = nextDate;

        // Fin par max_occurrences
        if (rule.max_occurrences && newCount >= rule.max_occurrences) {
            newStatus = 'completed';
            finalNextDate = null;
        }

        // Fin par date de fin
        if (nextDate && rule.end_date) {
            const endDate = new Date(rule.end_date);
            if (nextDate > endDate) {
                newStatus = 'completed';
                finalNextDate = null;
            }
        }

        // Mettre a jour la regle
        await client.query(`
            UPDATE recurring_invoices
            SET occurrences_count = $1,
                next_issue_date = $2,
                status = $3,
                updated_at = NOW()
            WHERE id = $4
        `, [
            newCount,
            finalNextDate ? finalNextDate.toISOString().slice(0, 10) : null,
            newStatus,
            rule.id
        ]);

        // Log
        await client.query(`
            INSERT INTO recurring_invoice_logs (
                user_id, recurring_id, invoice_id, invoice_number, action, details
            )
            VALUES ($1, $2, $3, $4, 'generated', $5)
        `, [
            rule.user_id,
            rule.id,
            invoiceId,
            invoiceNumber,
            JSON.stringify({ amount: rule.total, occurrence: newCount })
        ]);

        await client.query('COMMIT');

        return {
            invoiceId,
            invoiceNumber,
            nextIssueDate: finalNextDate,
            newStatus,
            occurrenceCount: newCount
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Traite toutes les regles dues aujourd'hui (pour un user ou tous)
// ------------------------------------------------------------
async function processDueRecurringInvoices(userId = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let query = `
        SELECT * FROM recurring_invoices
        WHERE status = 'active'
          AND next_issue_date IS NOT NULL
          AND next_issue_date <= CURRENT_DATE
    `;
    const params = [];

    if (userId) {
        params.push(userId);
        query += ' AND user_id = $1';
    }

    const result = await pool.query(query, params);

    const processed = [];
    const failed = [];

    for (const rule of result.rows) {
        try {
            const gen = await generateInvoiceFromRule(rule);
            processed.push({
                ruleId: rule.id,
                ruleName: rule.name,
                invoiceNumber: gen.invoiceNumber,
                nextIssueDate: gen.nextIssueDate
            });
        } catch (err) {
            console.error('Erreur generation facture recurrente ' + rule.id + ':', err.message);

            // Log erreur
            try {
                await pool.query(`
                    INSERT INTO recurring_invoice_logs (
                        user_id, recurring_id, action, error_message
                    )
                    VALUES ($1, $2, 'error', $3)
                `, [rule.user_id, rule.id, err.message]);
            } catch (logErr) {
                console.warn('Erreur log:', logErr.message);
            }

            failed.push({
                ruleId: rule.id,
                ruleName: rule.name,
                error: err.message
            });
        }
    }

    return { processed, failed, total: result.rows.length };
}

// ------------------------------------------------------------
// Recalcule les totaux d'une regle a partir des items
// ------------------------------------------------------------
function computeRuleTotals(items, vatRegime, vatRate) {
    let subtotal = 0;
    const formatted = [];

    for (const item of items) {
        const qty = parseFloat(item.qty) || 1;
        const unitPrice = parseFloat(item.unitPrice) || 0;
        const total = Math.round(qty * unitPrice * 100) / 100;

        subtotal += total;
        formatted.push({
            ref: item.ref || 'EXT',
            name: item.name || 'Article',
            qty,
            unitPrice,
            total
        });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const vatAmount = vatRegime === 'assujetti'
        ? Math.round(subtotal * (vatRate / 100) * 100) / 100
        : 0;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    return { items: formatted, subtotal, vatAmount, total };
}

module.exports = {
    FREQUENCIES,
    STATUSES,
    computeNextIssueDate,
    shouldIssueToday,
    generateInvoiceFromRule,
    processDueRecurringInvoices,
    computeRuleTotals
};