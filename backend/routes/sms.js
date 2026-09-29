// backend/routes/sms.js
// Routes pour la configuration et l'envoi de SMS

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    DEFAULT_TEMPLATES,
    sendSms,
    sendQuoteSms,
    sendInvoiceReminderSms
} = require('../utils/sms/sender');

const router = express.Router();

// ============================================================
// GET /api/sms/config — Configuration SMS actuelle
// ============================================================
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sms_enabled, sms_provider, sms_account_sid, sms_from_number,
                   sms_notify_signature, sms_template_quote, sms_template_reminder,
                   sms_template_appointment, phone
            FROM settings WHERE user_id = $1
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                provider: 'twilio',
                accountSid: '',
                hasAuthToken: false,
                fromNumber: '',
                notifySignature: true,
                templateQuote: DEFAULT_TEMPLATES.quote,
                templateReminder: DEFAULT_TEMPLATES.reminder,
                templateAppointment: DEFAULT_TEMPLATES.appointment,
                ownerPhone: '',
                defaults: DEFAULT_TEMPLATES
            });
        }

        const s = result.rows[0];

        res.json({
            enabled: s.sms_enabled || false,
            provider: s.sms_provider || 'twilio',
            accountSid: s.sms_account_sid || '',
            hasAuthToken: !!s.sms_auth_token,
            fromNumber: s.sms_from_number || '',
            notifySignature: s.sms_notify_signature !== false,
            templateQuote: s.sms_template_quote || DEFAULT_TEMPLATES.quote,
            templateReminder: s.sms_template_reminder || DEFAULT_TEMPLATES.reminder,
            templateAppointment: s.sms_template_appointment || DEFAULT_TEMPLATES.appointment,
            ownerPhone: s.phone || '',
            defaults: DEFAULT_TEMPLATES
        });
    } catch (err) {
        console.error('Erreur get sms config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/sms/config — Sauvegarder la configuration
// ============================================================
router.post('/config', authenticateToken, async (req, res) => {
    const {
        enabled, provider, accountSid, authToken, fromNumber,
        notifySignature, templateQuote, templateReminder, templateAppointment,
        ownerPhone
    } = req.body;

    try {
        // Verifier que la ligne settings existe
        await pool.query(
            'INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        // Construire les updates dynamiquement
        const updates = [];
        const params = [req.user.id];
        let idx = 2;

        if (enabled !== undefined) {
            updates.push('sms_enabled = $' + idx);
            params.push(enabled === true);
            idx++;
        }
        if (provider) {
            updates.push('sms_provider = $' + idx);
            params.push(provider);
            idx++;
        }
        if (accountSid !== undefined) {
            updates.push('sms_account_sid = $' + idx);
            params.push(accountSid || null);
            idx++;
        }
        if (authToken !== undefined && authToken !== '') {
            updates.push('sms_auth_token = $' + idx);
            params.push(authToken);
            idx++;
        }
        if (fromNumber !== undefined) {
            updates.push('sms_from_number = $' + idx);
            params.push(fromNumber || null);
            idx++;
        }
        if (notifySignature !== undefined) {
            updates.push('sms_notify_signature = $' + idx);
            params.push(notifySignature === true);
            idx++;
        }
        if (templateQuote !== undefined) {
            updates.push('sms_template_quote = $' + idx);
            params.push(templateQuote || null);
            idx++;
        }
        if (templateReminder !== undefined) {
            updates.push('sms_template_reminder = $' + idx);
            params.push(templateReminder || null);
            idx++;
        }
        if (templateAppointment !== undefined) {
            updates.push('sms_template_appointment = $' + idx);
            params.push(templateAppointment || null);
            idx++;
        }
        if (ownerPhone !== undefined) {
            updates.push('phone = $' + idx);
            params.push(ownerPhone || null);
            idx++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune modification.' });
        }

        updates.push('updated_at = NOW()');

        await pool.query(
            'UPDATE settings SET ' + updates.join(', ') + ' WHERE user_id = $1',
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur save sms config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/sms/test — Envoyer un SMS de test
// ============================================================
router.post('/test', authenticateToken, async (req, res) => {
    const { to, message } = req.body;

    if (!to) return res.status(400).json({ error: 'Numero de telephone requis.' });

    const body = message || 'Test SMS depuis Devis Express Pro. Si vous recevez ce message, la configuration fonctionne.';

    try {
        const result = await sendSms(req.user.id, to, body, { smsType: 'test' });

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId, cost: result.cost });
    } catch (err) {
        console.error('Erreur test SMS:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/sms/send-quote/:quoteId — Envoyer un devis par SMS
// ============================================================
router.post('/send-quote/:quoteId', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.quoteId);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Charger le devis
        const quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );

        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const quote = quoteResult.rows[0];

        if (!quote.public_token) {
            return res.status(400).json({ error: 'Le devis n\'a pas encore ete envoye au client. Utilisez d\'abord "Envoyer au client".' });
        }

        const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
        const publicUrl = baseUrl + '/sign.html?token=' + quote.public_token;

        const result = await sendQuoteSms(req.user.id, quote, publicUrl);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
    } catch (err) {
        console.error('Erreur send quote sms:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/sms/send-reminder/:invoiceId — Relance impaye par SMS
// ============================================================
router.post('/send-reminder/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );

        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        const result = await sendInvoiceReminderSms(req.user.id, invoiceResult.rows[0]);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
    } catch (err) {
        console.error('Erreur send reminder sms:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/sms/logs — Historique des SMS
// ============================================================
router.get('/logs', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const smsType = req.query.type;

        let query = 'SELECT * FROM sms_logs WHERE user_id = $1';
        const params = [req.user.id];

        if (smsType) {
            params.push(smsType);
            query += ' AND sms_type = $' + params.length;
        }

        query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await pool.query(query, params);

        res.json(result.rows.map(l => ({
            id: l.id,
            toNumber: l.to_number,
            fromNumber: l.from_number,
            body: l.body,
            smsType: l.sms_type,
            status: l.status,
            provider: l.provider,
            providerMessageId: l.provider_message_id,
            errorMessage: l.error_message,
            cost: l.cost ? parseFloat(l.cost) : null,
            relatedQuoteId: l.related_quote_id,
            relatedInvoiceId: l.related_invoice_id,
            createdAt: l.created_at
        })));
    } catch (err) {
        console.error('Erreur get sms logs:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/sms/stats — Statistiques d'usage
// ============================================================
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const [total, month, failed, cost] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM sms_logs WHERE user_id = $1', [req.user.id]),
            pool.query(`
                SELECT COUNT(*) FROM sms_logs
                WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
            `, [req.user.id]),
            pool.query(`
                SELECT COUNT(*) FROM sms_logs
                WHERE user_id = $1 AND status = 'failed'
            `, [req.user.id]),
            pool.query(`
                SELECT COALESCE(SUM(cost), 0) as total_cost
                FROM sms_logs WHERE user_id = $1
            `, [req.user.id])
        ]);

        res.json({
            totalSent: parseInt(total.rows[0].count),
            last30Days: parseInt(month.rows[0].count),
            failed: parseInt(failed.rows[0].count),
            totalCost: parseFloat(cost.rows[0].total_cost)
        });
    } catch (err) {
        console.error('Erreur get sms stats:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;