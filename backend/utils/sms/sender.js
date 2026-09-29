// backend/utils/sms/sender.js
// Envoi de SMS via Twilio

const { pool } = require('../../db');

// Templates par defaut (utilises si l'utilisateur n'a rien configure)
const DEFAULT_TEMPLATES = {
    quote: 'Bonjour {client}, votre devis {quoteNumber} d\'un montant de {total} EUR est disponible. Consultez-le ici : {link}',
    reminder: 'Bonjour {client}, nous vous rappelons que la facture {invoiceNumber} d\'un montant de {amount} EUR est en attente de reglement. Merci.',
    appointment: 'Bonjour {client}, votre rendez-vous avec {company} est confirme pour le {date} a {time}. A bientot.',
    signature_notification: 'Votre client {client} vient de signer le devis {quoteNumber} ({total} EUR).'
};

// Remplace les variables dans un template
function renderTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp('\\{' + key + '\\}', 'g');
        result = result.replace(regex, value !== null && value !== undefined ? String(value) : '');
    }
    return result;
}

// Envoie un SMS via Twilio
async function sendViaTwilio(accountSid, authToken, fromNumber, toNumber, body) {
    const url = 'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json';

    const params = new URLSearchParams();
    params.append('From', fromNumber);
    params.append('To', toNumber);
    params.append('Body', body);

    const auth = Buffer.from(accountSid + ':' + authToken).toString('base64');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + auth,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Erreur Twilio');
    }

    return {
        messageId: data.sid,
        status: data.status,
        cost: data.price ? Math.abs(parseFloat(data.price)) : null
    };
}

// Charge la config SMS de l'utilisateur
async function getUserSmsConfig(userId) {
    const result = await pool.query(
        'SELECT sms_enabled, sms_provider, sms_account_sid, sms_auth_token, sms_from_number, sms_template_quote, sms_template_reminder, sms_template_appointment FROM settings WHERE user_id = $1',
        [userId]
    );

    if (result.rows.length === 0) return null;
    const s = result.rows[0];

    if (!s.sms_enabled) return null;
    if (!s.sms_account_sid || !s.sms_auth_token || !s.sms_from_number) return null;

    return {
        enabled: s.sms_enabled,
        provider: s.sms_provider || 'twilio',
        accountSid: s.sms_account_sid,
        authToken: s.sms_auth_token,
        fromNumber: s.sms_from_number,
        templateQuote: s.sms_template_quote || DEFAULT_TEMPLATES.quote,
        templateReminder: s.sms_template_reminder || DEFAULT_TEMPLATES.reminder,
        templateAppointment: s.sms_template_appointment || DEFAULT_TEMPLATES.appointment
    };
}

// Envoie un SMS et log en base
async function sendSms(userId, toNumber, body, options = {}) {
    const config = await getUserSmsConfig(userId);

    if (!config) {
        // Logger en echec mais ne pas planter
        await logSms(userId, toNumber, body, {
            smsType: options.smsType,
            relatedQuoteId: options.relatedQuoteId,
            relatedInvoiceId: options.relatedInvoiceId,
            status: 'failed',
            errorMessage: 'SMS non configure ou desactive'
        });
        return { success: false, error: 'SMS non configure ou desactive' };
    }

    try {
        const result = await sendViaTwilio(
            config.accountSid,
            config.authToken,
            config.fromNumber,
            toNumber,
            body
        );

        await logSms(userId, toNumber, body, {
            fromNumber: config.fromNumber,
            smsType: options.smsType,
            relatedQuoteId: options.relatedQuoteId,
            relatedInvoiceId: options.relatedInvoiceId,
            provider: config.provider,
            providerMessageId: result.messageId,
            status: 'sent',
            cost: result.cost
        });

        return { success: true, messageId: result.messageId, cost: result.cost };
    } catch (err) {
        await logSms(userId, toNumber, body, {
            fromNumber: config.fromNumber,
            smsType: options.smsType,
            relatedQuoteId: options.relatedQuoteId,
            relatedInvoiceId: options.relatedInvoiceId,
            provider: config.provider,
            status: 'failed',
            errorMessage: err.message
        });

        return { success: false, error: err.message };
    }
}

// Log un SMS en base
async function logSms(userId, toNumber, body, options) {
    try {
        await pool.query(`
            INSERT INTO sms_logs (
                user_id, to_number, from_number, body, sms_type,
                related_quote_id, related_invoice_id, provider,
                provider_message_id, status, error_message, cost
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            userId,
            toNumber,
            options.fromNumber || null,
            body,
            options.smsType || 'generic',
            options.relatedQuoteId || null,
            options.relatedInvoiceId || null,
            options.provider || 'twilio',
            options.providerMessageId || null,
            options.status || 'pending',
            options.errorMessage || null,
            options.cost || null
        ]);
    } catch (err) {
        console.warn('Erreur log SMS:', err.message);
    }
}

// Envoie un SMS de devis au client
async function sendQuoteSms(userId, quote, publicUrl) {
    const config = await getUserSmsConfig(userId);
    if (!config) return { success: false, error: 'SMS non configure' };

    if (!quote.client_phone) {
        return { success: false, error: 'Aucun numero de telephone client' };
    }

    const settingsResult = await pool.query(
        'SELECT company_name FROM settings WHERE user_id = $1',
        [userId]
    );
    const companyName = settingsResult.rows[0]?.company_name || 'Notre entreprise';

    const body = renderTemplate(config.templateQuote, {
        client: quote.client_name || '',
        quoteNumber: quote.quote_number,
        total: parseFloat(quote.total).toFixed(2),
        link: publicUrl,
        company: companyName
    });

    return await sendSms(userId, quote.client_phone, body, {
        smsType: 'quote',
        relatedQuoteId: quote.id
    });
}

// Envoie un SMS de relance d'impaye
async function sendInvoiceReminderSms(userId, invoice, level = 1) {
    const config = await getUserSmsConfig(userId);
    if (!config) return { success: false, error: 'SMS non configure' };

    if (!invoice.client_phone) {
        return { success: false, error: 'Aucun numero de telephone client' };
    }

    const settingsResult = await pool.query(
        'SELECT company_name FROM settings WHERE user_id = $1',
        [userId]
    );
    const companyName = settingsResult.rows[0]?.company_name || 'Notre entreprise';

    const body = renderTemplate(config.templateReminder, {
        client: invoice.client_name || '',
        invoiceNumber: invoice.invoice_number,
        amount: parseFloat(invoice.amount_due || invoice.total).toFixed(2),
        company: companyName
    });

    return await sendSms(userId, invoice.client_phone, body, {
        smsType: 'reminder',
        relatedInvoiceId: invoice.id
    });
}

// Notifie le proprietaire qu'un client a signe
async function sendSignatureNotificationSms(userId, quote) {
    const config = await getUserSmsConfig(userId);
    if (!config) return { success: false, error: 'SMS non configure' };

    const settingsResult = await pool.query(
        'SELECT sms_notify_signature, phone FROM settings WHERE user_id = $1',
        [userId]
    );
    const s = settingsResult.rows[0] || {};

    if (s.sms_notify_signature === false) {
        return { success: false, error: 'Notification SMS desactivee' };
    }

    if (!s.phone) {
        return { success: false, error: 'Aucun numero de telephone dans les parametres' };
    }

    const body = renderTemplate(DEFAULT_TEMPLATES.signature_notification, {
        client: quote.client_name || '',
        quoteNumber: quote.quote_number,
        total: parseFloat(quote.total).toFixed(2)
    });

    return await sendSms(userId, s.phone, body, {
        smsType: 'signature_notification',
        relatedQuoteId: quote.id
    });
}

module.exports = {
    DEFAULT_TEMPLATES,
    renderTemplate,
    getUserSmsConfig,
    sendSms,
    sendQuoteSms,
    sendInvoiceReminderSms,
    sendSignatureNotificationSms
};