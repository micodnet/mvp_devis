// backend/utils/cron/reminders-cron.js
// Envoi automatique des relances (à appeler périodiquement)

const { pool } = require('../../db');
const { findInvoicesToRemind } = require('../invoice-helpers');
const { Resend } = require('resend');

// ------------------------------------------------------------
// Envoie les relances pour un utilisateur
// ------------------------------------------------------------
async function processUserReminders(userId) {
    const toRemind = await findInvoicesToRemind(userId);
    if (toRemind.length === 0) return { sent: 0 };

    const settingsResult = await pool.query(
        'SELECT company_name, payment_terms FROM settings WHERE user_id = $1',
        [userId]
    );
    const companyName = settingsResult.rows[0]?.company_name || '';

    const reminderSettings = await pool.query(
        'SELECT * FROM reminder_settings WHERE user_id = $1',
        [userId]
    );
    const rs = reminderSettings.rows[0];

    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    let sent = 0;

    for (const { invoice, level, daysOverdue } of toRemind) {
        if (!invoice.client_email) continue;

        const subjects = {
            1: `Rappel amiable - Facture ${invoice.invoice_number}`,
            2: `Relance - Facture ${invoice.invoice_number}`,
            3: `Mise en demeure - Facture ${invoice.invoice_number}`
        };
        const subject = subjects[Math.min(level, 3)];

        try {
            if (resend) {
                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'noreply@votreentreprise.com',
                    to: [invoice.client_email],
                    subject,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                            <h2>${subject}</h2>
                            <p>Bonjour ${invoice.client_name || ''},</p>
                            <p>Sauf erreur de notre part, la facture <strong>${invoice.invoice_number}</strong>
                            d'un montant de <strong>${parseFloat(invoice.amount_due || invoice.total).toFixed(2)} €</strong>
                            reste impayée ${daysOverdue} jours après son échéance.</p>
                            <p>Nous vous remercions de procéder au règlement.</p>
                            <p>Cordialement,<br>${companyName}</p>
                        </div>
                    `
                });
            }

            await pool.query(`
                INSERT INTO payment_reminders (user_id, invoice_id, reminder_level, sent_to_email, status)
                VALUES ($1, $2, $3, $4, 'sent')
            `, [userId, invoice.id, level, invoice.client_email]);

            sent++;
            console.log(`📧 Relance ${level} envoyée pour facture ${invoice.invoice_number}`);
        } catch (err) {
            console.error(`Erreur relance facture ${invoice.invoice_number}:`, err.message);
            await pool.query(`
                INSERT INTO payment_reminders (user_id, invoice_id, reminder_level, sent_to_email, status, error_message)
                VALUES ($1, $2, $3, $4, 'failed', $5)
            `, [userId, invoice.id, level, invoice.client_email, err.message]);
        }
    }

    return { sent };
}

// ------------------------------------------------------------
// Traite les relances pour tous les utilisateurs
// ------------------------------------------------------------
async function processAllReminders() {
    console.log('🔔 Démarrage du cron de relances...');
    try {
        const usersResult = await pool.query(`
            SELECT DISTINCT user_id 
            FROM reminder_settings 
            WHERE enabled = TRUE
        `);
        
        let totalSent = 0;
        for (const row of usersResult.rows) {
            const result = await processUserReminders(row.user_id);
            totalSent += result.sent;
        }
        
        console.log(`🔔 Cron terminé : ${totalSent} relance(s) envoyée(s).`);
        return { totalSent };
    } catch (err) {
        console.error('Erreur cron relances:', err);
        return { error: err.message };
    }
}

// ------------------------------------------------------------
// Démarre le cron (toutes les heures)
// ------------------------------------------------------------
function startRemindersCron() {
    // Lancer au démarrage (après 30 secondes)
    setTimeout(() => {
        processAllReminders().catch(console.error);
    }, 30000);

    // Puis toutes les heures
    setInterval(() => {
        processAllReminders().catch(console.error);
    }, 60 * 60 * 1000);

    console.log('✅ Cron de relances démarré (toutes les heures)');
}

module.exports = {
    processUserReminders,
    processAllReminders,
    startRemindersCron
};