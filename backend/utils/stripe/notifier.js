// backend/utils/stripe/notifier.js
// Notification email quand un paiement en ligne est recu

const { Resend } = require('resend');
const { pool } = require('../../db');

function formatMoney(n, currency) {
    const num = parseFloat(n) || 0;
    const cur = currency || 'EUR';
    const symbols = { EUR: '€', USD: '$', CHF: 'CHF', GBP: '£' };
    const symbol = symbols[cur] || cur;
    if (cur === 'USD' || cur === 'GBP') {
        return symbol + num.toFixed(2);
    }
    return num.toFixed(2) + ' ' + symbol;
}

async function notifyInvoicePaidOnline(userId, invoiceId, amount) {
    if (!process.env.RESEND_API_KEY) return;

    try {
        // Charger la facture et l'utilisateur
        const result = await pool.query(`
            SELECT i.*, s.company_name, s.email as company_email, u.email as owner_email
            FROM invoices i
            LEFT JOIN settings s ON s.user_id = i.user_id
            LEFT JOIN users u ON u.id = i.user_id
            WHERE i.id = $1 AND i.user_id = $2
        `, [invoiceId, userId]);

        if (result.rows.length === 0) return;

        const inv = result.rows[0];
        const ownerEmail = inv.owner_email;
        if (!ownerEmail) return;

        const resend = new Resend(process.env.RESEND_API_KEY);
        const companyName = inv.company_name || 'Votre entreprise';

        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Paiement en ligne <noreply@votreentreprise.com>',
            to: [ownerEmail],
            subject: 'Paiement recu - Facture ' + inv.invoice_number,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                    <div style="background:#22c55e;color:#fff;padding:20px;border-radius:10px;text-align:center;margin-bottom:24px;">
                        <div style="font-size:36px;margin-bottom:8px;">OK</div>
                        <h1 style="margin:0;font-size:20px;">Paiement recu</h1>
                    </div>
                    <p style="font-size:15px;line-height:1.6;color:#334155;">
                        Votre client <strong>${inv.client_name || ''}</strong> vient de payer en ligne la facture <strong>${inv.invoice_number}</strong>.
                    </p>
                    <p style="font-size:15px;line-height:1.6;color:#334155;">
                        Montant : <strong>${formatMoney(amount, inv.currency)}</strong>
                    </p>
                    <p style="font-size:13px;color:#64748b;line-height:1.6;">
                        Le statut de la facture a ete mis a jour automatiquement dans votre application.
                    </p>
                    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                    <p style="font-size:12px;color:#94a3b8;">
                        ${companyName}
                    </p>
                </div>
            `
        });

        console.log('Notification email paiement envoyee a', ownerEmail);
    } catch (err) {
        console.error('Erreur notifyInvoicePaidOnline:', err.message);
    }
}

module.exports = { notifyInvoicePaidOnline };