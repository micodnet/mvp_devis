// backend/utils/bank/matcher.js
// Moteur de rapprochement entre transactions bancaires et factures

const { pool } = require('../../db');

// ------------------------------------------------------------
// Normalise une chaine pour comparaison (minuscules, sans accents)
// ------------------------------------------------------------
function normalize(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

// ------------------------------------------------------------
// Cherche dans une transaction des references de factures
// ------------------------------------------------------------
function findInvoiceReferences(text) {
    if (!text) return [];

    const refs = [];
    // Format FAC-2026-0012, FAC2026001, etc.
    const patterns = [
        /FAC[\s\-_]?(\d{4})[\s\-_]?(\d{3,6})/gi,
        /FAC[\s\-_]?(\d{3,6})/gi,
        /(\d{4})[\s\-_]?(\d{3,6})/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            refs.push(match[0].toUpperCase().replace(/[\s\-_]/g, ''));
        }
    }

    return [...new Set(refs)];
}

// ------------------------------------------------------------
// Calcule un score de correspondance entre une transaction et une facture
// Retourne un objet { score: 0-100, reason: string }
// ------------------------------------------------------------
function scoreMatch(transaction, invoice) {
    let score = 0;
    const reasons = [];

    const txAmount = Math.abs(parseFloat(transaction.amount));
    const invAmountDue = parseFloat(invoice.amount_due || invoice.total);

    // 1. Montant identique (poids fort : 50 points)
    if (Math.abs(txAmount - invAmountDue) < 0.01) {
        score += 50;
        reasons.push('montant identique');
    } else if (Math.abs(txAmount - invAmountDue) < 1) {
        score += 30;
        reasons.push('montant proche');
    } else {
        // Verifier si c'est un paiement partiel
        if (txAmount < invAmountDue && txAmount > 0) {
            const ratio = txAmount / invAmountDue;
            if (ratio >= 0.1 && ratio <= 0.99) {
                score += 15;
                reasons.push('paiement partiel possible');
            }
        }
    }

    // 2. Reference de facture dans la description (poids fort : 35 points)
    const txText = (transaction.description || '') + ' ' + (transaction.reference || '') + ' ' + (transaction.counterparty || '');
    const txNormalized = txText.toUpperCase().replace(/[\s\-_]/g, '');
    const invNumberNormalized = (invoice.invoice_number || '').toUpperCase().replace(/[\s\-_]/g, '');

    if (invNumberNormalized && txNormalized.includes(invNumberNormalized)) {
        score += 35;
        reasons.push('reference de facture trouvee');
    } else {
        // Chercher une reference partielle
        const invRefs = findInvoiceReferences(txText);
        if (invRefs.length > 0) {
            for (const ref of invRefs) {
                if (invNumberNormalized.includes(ref) || ref.includes(invNumberNormalized)) {
                    score += 25;
                    reasons.push('reference partielle trouvee');
                    break;
                }
            }
        }
    }

    // 3. Nom du client dans la transaction (poids moyen : 20 points)
    if (invoice.client_name) {
        const clientNormalized = normalize(invoice.client_name);
        const txTextNormalized = normalize(txText);

        if (clientNormalized.length >= 3 && txTextNormalized.includes(clientNormalized)) {
            score += 20;
            reasons.push('nom du client trouve');
        }
    }

    // 4. Date coherente (transaction APRES emission de la facture, max 6 mois)
    if (invoice.issue_date) {
        const invoiceDate = new Date(invoice.issue_date);
        const txDate = new Date(transaction.transaction_date);
        const daysDiff = Math.floor((txDate - invoiceDate) / (1000 * 60 * 60 * 24));

        if (daysDiff >= 0 && daysDiff <= 180) {
            score += 10;
            reasons.push('date coherente');
        } else if (daysDiff > 180) {
            // Transaction trop vieille pour cette facture
            score -= 20;
        } else if (daysDiff < -1) {
            // Transaction anterieure a la facture (impossible sauf erreur)
            score -= 50;
        }
    }

    // Plafond a 100
    score = Math.max(0, Math.min(100, score));

    return {
        score: score,
        reason: reasons.join(', ')
    };
}

// ------------------------------------------------------------
// Trouve les meilleures correspondances pour une transaction
// ------------------------------------------------------------
async function findMatches(transaction, userId) {
    // On ne rapproche que les credits (virements entrants)
    if (transaction.amount <= 0) {
        return [];
    }

    // Charger les factures en attente de paiement
    const invoicesResult = await pool.query(`
        SELECT id, invoice_number, client_name, client_email, total, amount_due,
               amount_paid, issue_date, due_date, currency, status
        FROM invoices
        WHERE user_id = $1
          AND status IN ('sent', 'partial', 'overdue')
          AND COALESCE(amount_due, total) > 0.01
        ORDER BY issue_date DESC
        LIMIT 100
    `, [userId]);

    const candidates = [];

    for (const invoice of invoicesResult.rows) {
        const match = scoreMatch(transaction, invoice);

        if (match.score >= 30) {
            candidates.push({
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                clientName: invoice.client_name,
                amountDue: parseFloat(invoice.amount_due || invoice.total),
                issueDate: invoice.issue_date,
                dueDate: invoice.due_date,
                currency: invoice.currency || 'EUR',
                score: match.score,
                reason: match.reason
            });
        }
    }

    // Trier par score descendant
    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, 5);
}

// ------------------------------------------------------------
// Rapproche automatiquement toutes les transactions non traitees d'un utilisateur
// ------------------------------------------------------------
async function autoMatchAll(userId) {
    // Charger toutes les transactions en attente (credit uniquement)
    const txResult = await pool.query(`
        SELECT * FROM bank_transactions
        WHERE user_id = $1
          AND status = 'pending'
          AND amount > 0
        ORDER BY transaction_date DESC
    `, [userId]);

    let matched = 0;
    let highConfidence = 0;

    for (const tx of txResult.rows) {
        const candidates = await findMatches(tx, userId);

        if (candidates.length === 0) continue;

        const best = candidates[0];

        // Si score >= 70, on propose directement
        if (best.score >= 70) {
            highConfidence++;
        }

        // Mettre a jour la transaction avec la meilleure correspondance proposee
        await pool.query(`
            UPDATE bank_transactions
            SET matched_invoice_id = $1,
                match_score = $2,
                match_reason = $3,
                status = 'suggested'
            WHERE id = $4
        `, [best.invoiceId, best.score, best.reason, tx.id]);

        matched++;
    }

    return { matched, highConfidence };
}

// ------------------------------------------------------------
// Valide un rapprochement : enregistre le paiement sur la facture
// ------------------------------------------------------------
async function validateMatch(userId, transactionId, invoiceId) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Charger la transaction
        const txResult = await client.query(
            'SELECT * FROM bank_transactions WHERE id = $1 AND user_id = $2',
            [transactionId, userId]
        );

        if (txResult.rows.length === 0) {
            throw new Error('Transaction introuvable.');
        }

        const tx = txResult.rows[0];

        // Charger la facture
        const invResult = await client.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, userId]
        );

        if (invResult.rows.length === 0) {
            throw new Error('Facture introuvable.');
        }

        const invoice = invResult.rows[0];

        const txAmount = Math.abs(parseFloat(tx.amount));
        const invoiceAmountPaid = parseFloat(invoice.amount_paid) || 0;
        const newAmountPaid = invoiceAmountPaid + txAmount;
        const invoiceTotal = parseFloat(invoice.total);
        const newAmountDue = Math.max(0, invoiceTotal - newAmountPaid);
        const newStatus = newAmountDue <= 0.01 ? 'paid' : 'partial';

        // Ajouter dans invoice_payments
        await client.query(`
            INSERT INTO invoice_payments (
                user_id, invoice_id, amount, payment_date,
                payment_method, reference, notes
            )
            VALUES ($1, $2, $3, $4, 'virement_bancaire', $5, $6)
        `, [
            userId,
            invoiceId,
            txAmount,
            tx.transaction_date,
            tx.reference || tx.description || 'Virement importe',
            'Rapproche bancaire automatique (transaction ' + tx.id + ')'
        ]);

        // Mettre a jour la facture
        await client.query(`
            UPDATE invoices
            SET amount_paid = $1,
                amount_due = $2,
                status = $3,
                payment_date = $4,
                payment_method = 'virement',
                updated_at = NOW()
            WHERE id = $5
        `, [newAmountPaid, newAmountDue, newStatus, tx.transaction_date, invoiceId]);

        // Mettre a jour la transaction
        await client.query(`
            UPDATE bank_transactions
            SET matched_invoice_id = $1,
                status = 'validated',
                validated_at = NOW()
            WHERE id = $2
        `, [invoiceId, transactionId]);

        await client.query('COMMIT');

        return {
            success: true,
            newAmountPaid,
            newAmountDue,
            invoiceStatus: newStatus
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    normalize,
    findInvoiceReferences,
    scoreMatch,
    findMatches,
    autoMatchAll,
    validateMatch
};