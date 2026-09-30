// backend/routes/chat.js
// Routes du chat client (proprietaire + public + portail client)

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requireClientAuth } = require('../middleware/client-auth');
const { Resend } = require('resend');
const {
    getOrCreateConversation,
    addMessage,
    getMessages,
    markAsReadByOwner,
    markAsReadByClient,
    listConversations,
    getConversationByToken,
    getClientConversations
} = require('../utils/chat/helpers');

const router = express.Router();

// ============================================================
// PARTIE PROPRIETAIRE
// ============================================================

// ------------------------------------------------------------
// GET /api/chat/conversations
// ------------------------------------------------------------
router.get('/conversations', authenticateToken, async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const conversations = await listConversations(req.user.id, filter);
        res.json(conversations);
    } catch (err) {
        console.error('Erreur list conversations:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/chat/conversations/:id
// ------------------------------------------------------------
router.get('/conversations/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const convResult = await pool.query(`
            SELECT c.*,
                   q.quote_number as quote_number,
                   i.invoice_number as invoice_number,
                   ch.name as chantier_name
            FROM client_conversations c
            LEFT JOIN quotes q ON q.id = c.related_quote_id
            LEFT JOIN invoices i ON i.id = c.related_invoice_id
            LEFT JOIN chantiers ch ON ch.id = c.related_chantier_id
            WHERE c.id = $1 AND c.user_id = $2
        `, [id, req.user.id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        const c = convResult.rows[0];
        const messages = await getMessages(id);
        await markAsReadByOwner(id, req.user.id);

        res.json({
            conversation: {
                id: c.id,
                clientId: c.client_id,
                clientName: c.client_name,
                clientEmail: c.client_email,
                subject: c.subject,
                relatedQuoteId: c.related_quote_id,
                relatedInvoiceId: c.related_invoice_id,
                relatedChantierId: c.related_chantier_id,
                quoteNumber: c.quote_number,
                invoiceNumber: c.invoice_number,
                chantierName: c.chantier_name,
                status: c.status,
                accessToken: c.access_token,
                createdAt: c.created_at
            },
            messages: messages
        });
    } catch (err) {
        console.error('Erreur get conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/chat/conversations/:id/messages
// ------------------------------------------------------------
router.post('/conversations/:id/messages', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { body } = req.body;

    if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    try {
        const checkResult = await pool.query(
            'SELECT * FROM client_conversations WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        const conversation = checkResult.rows[0];

        const settingsResult = await pool.query(
            'SELECT company_name FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const companyName = settingsResult.rows[0]?.company_name || 'Entreprise';

        const message = await addMessage(id, 'owner', companyName, body);

        if (conversation.client_email && process.env.RESEND_API_KEY) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
                const chatUrl = baseUrl + '/client.html';

                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'Notification <noreply@votreentreprise.com>',
                    to: [conversation.client_email],
                    subject: 'Nouveau message de ' + companyName,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <h1 style="color:#0b1120;font-size:20px;margin-bottom:16px;">Nouveau message</h1>
                            <p style="font-size:15px;line-height:1.6;">Bonjour ${conversation.client_name || ''},</p>
                            <p style="font-size:15px;line-height:1.6;">
                                Vous avez recu un nouveau message de <strong>${companyName}</strong>.
                            </p>
                            <div style="background:#f6f9fc;border-left:3px solid #f97316;padding:14px 18px;margin:20px 0;border-radius:8px;">
                                <p style="font-size:14px;color:#334155;margin:0;line-height:1.6;">${body.slice(0, 200)}${body.length > 200 ? '...' : ''}</p>
                            </div>
                            <p style="text-align:center;margin:28px 0;">
                                <a href="${chatUrl}" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Ouvrir mon espace client</a>
                            </p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.warn('Erreur envoi email chat:', emailErr.message);
            }
        }

        res.json({ success: true, message });
    } catch (err) {
        console.error('Erreur send message:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// PUT /api/chat/conversations/:id/status
// ------------------------------------------------------------
router.put('/conversations/:id/status', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { status } = req.body;

    if (!['open', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'Statut invalide.' });
    }

    try {
        const result = await pool.query(
            'UPDATE client_conversations SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id',
            [status, id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// DELETE /api/chat/conversations/:id
// ------------------------------------------------------------
router.delete('/conversations/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM client_conversations WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/chat/stats
// ------------------------------------------------------------
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'open') as open,
                COUNT(*) FILTER (WHERE status = 'closed') as closed,
                COALESCE(SUM(owner_unread_count), 0) as unread
            FROM client_conversations
            WHERE user_id = $1
        `, [req.user.id]);

        const r = result.rows[0];

        res.json({
            totalConversations: parseInt(r.total),
            openConversations: parseInt(r.open),
            closedConversations: parseInt(r.closed),
            unreadMessages: parseInt(r.unread)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PORTAIL CLIENT (client connecte via son compte)
// ============================================================

// ------------------------------------------------------------
// GET /api/chat/my-conversations — Liste les conversations du client connecte
// ------------------------------------------------------------
router.get('/my-conversations', requireClientAuth, async (req, res) => {
    try {
        const { pool: dbPool } = require('../db');

        // Recuperer les infos du client
        const clientResult = await dbPool.query(
            'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
            [req.clientUser.clientId, req.clientUser.ownerId]
        );

        const client = clientResult.rows[0] || {};

        const conversations = await getClientConversations(
            req.clientUser.ownerId,
            req.clientUser.clientId,
            client.email || req.clientUser.email
        );

        res.json(conversations);
    } catch (err) {
        console.error('Erreur my-conversations:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/chat/my-conversations — Creer une conversation (client connecte)
// ------------------------------------------------------------
router.post('/my-conversations', requireClientAuth, async (req, res) => {
    const { subject, relatedQuoteId, relatedInvoiceId, relatedChantierId } = req.body;

    try {
        const { pool: dbPool } = require('../db');

        const clientResult = await dbPool.query(
            'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
            [req.clientUser.clientId, req.clientUser.ownerId]
        );

        const client = clientResult.rows[0] || {};

        const conversation = await getOrCreateConversation(req.clientUser.ownerId, {
            clientId: req.clientUser.clientId,
            clientName: client.name || req.clientUser.email,
            clientEmail: client.email || req.clientUser.email,
            subject: subject,
            relatedQuoteId: relatedQuoteId,
            relatedInvoiceId: relatedInvoiceId,
            relatedChantierId: relatedChantierId
        });

        res.json({
            success: true,
            conversationId: conversation.id,
            accessToken: conversation.access_token
        });
    } catch (err) {
        console.error('Erreur create my-conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/chat/my-conversations/:id — Detail (client connecte)
// ------------------------------------------------------------
router.get('/my-conversations/:id', requireClientAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const { pool: dbPool } = require('../db');

        const clientResult = await dbPool.query(
            'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
            [req.clientUser.clientId, req.clientUser.ownerId]
        );

        const client = clientResult.rows[0] || {};

        const convResult = await dbPool.query(`
            SELECT c.*,
                   q.quote_number,
                   i.invoice_number,
                   ch.name as chantier_name
            FROM client_conversations c
            LEFT JOIN quotes q ON q.id = c.related_quote_id
            LEFT JOIN invoices i ON i.id = c.related_invoice_id
            LEFT JOIN chantiers ch ON ch.id = c.related_chantier_id
            WHERE c.id = $1 AND c.user_id = $2
              AND (c.client_id = $3 OR LOWER(c.client_email) = LOWER($4))
        `, [id, req.clientUser.ownerId, req.clientUser.clientId, client.email || req.clientUser.email || '']);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        const c = convResult.rows[0];
        const messages = await getMessages(id);
        await markAsReadByClient(id);

        res.json({
            conversation: {
                id: c.id,
                subject: c.subject,
                relatedQuoteId: c.related_quote_id,
                relatedInvoiceId: c.related_invoice_id,
                relatedChantierId: c.related_chantier_id,
                quoteNumber: c.quote_number,
                invoiceNumber: c.invoice_number,
                chantierName: c.chantier_name,
                status: c.status,
                createdAt: c.created_at
            },
            messages: messages
        });
    } catch (err) {
        console.error('Erreur get my-conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/chat/my-conversations/:id/messages — Repondre (client connecte)
// ------------------------------------------------------------
router.post('/my-conversations/:id/messages', requireClientAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { body } = req.body;

    if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    try {
        const { pool: dbPool } = require('../db');

        const clientResult = await dbPool.query(
            'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
            [req.clientUser.clientId, req.clientUser.ownerId]
        );

        const client = clientResult.rows[0] || {};

        // Verifier l'appartenance
        const convResult = await dbPool.query(`
            SELECT c.* FROM client_conversations c
            WHERE c.id = $1 AND c.user_id = $2
              AND (c.client_id = $3 OR LOWER(c.client_email) = LOWER($4))
        `, [id, req.clientUser.ownerId, req.clientUser.clientId, client.email || req.clientUser.email || '']);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        const message = await addMessage(id, 'client', client.name || req.clientUser.email, body);

        // Notifier le proprietaire
        try {
            const { sendNotificationToUser } = require('../utils/push/notifications');
            await sendNotificationToUser(req.clientUser.ownerId, {
                title: 'Nouveau message client',
                body: (client.name || 'Client') + ' : ' + body.slice(0, 80),
                icon: '/icons/icon-192x192.png',
                url: '/?tab=chat',
                tag: 'chat-' + id
            });
        } catch (pushErr) {
            console.warn('Erreur push:', pushErr.message);
        }

        res.json({ success: true, message });
    } catch (err) {
        console.error('Erreur send my-message:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PARTIE PUBLIQUE (via token)
// ============================================================

// ------------------------------------------------------------
// POST /api/chat/public/start
// ------------------------------------------------------------
router.post('/public/start', async (req, res) => {
    const { userId, clientId, clientName, clientEmail, subject, relatedQuoteId, relatedInvoiceId, relatedChantierId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId requis.' });
    }

    if (!clientName && !clientEmail) {
        return res.status(400).json({ error: 'Nom ou email requis.' });
    }

    try {
        const conversation = await getOrCreateConversation(userId, {
            clientId,
            clientName,
            clientEmail,
            subject,
            relatedQuoteId,
            relatedInvoiceId,
            relatedChantierId
        });

        res.json({
            success: true,
            conversationId: conversation.id,
            accessToken: conversation.access_token
        });
    } catch (err) {
        console.error('Erreur start conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/chat/public/:token
// ------------------------------------------------------------
router.get('/public/:token', async (req, res) => {
    const { token } = req.params;

    if (!token || token.length < 32) {
        return res.status(400).json({ error: 'Token invalide.' });
    }

    try {
        const conversation = await getConversationByToken(token);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        const messages = await getMessages(conversation.id);
        await markAsReadByClient(conversation.id);

        res.json({
            conversation: {
                id: conversation.id,
                clientName: conversation.clientName,
                clientEmail: conversation.clientEmail,
                subject: conversation.subject,
                relatedQuoteId: conversation.relatedQuoteId,
                relatedInvoiceId: conversation.relatedInvoiceId,
                status: conversation.status,
                companyName: conversation.companyName,
                companyLogo: conversation.companyLogo
            },
            messages: messages
        });
    } catch (err) {
        console.error('Erreur get public conversation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/chat/public/:token/messages
// ------------------------------------------------------------
router.post('/public/:token/messages', async (req, res) => {
    const { token } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    try {
        const conversation = await getConversationByToken(token);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation introuvable.' });
        }

        if (conversation.status === 'closed') {
            return res.status(400).json({ error: 'Cette conversation est fermee.' });
        }

        const message = await addMessage(
            conversation.id,
            'client',
            conversation.clientName || 'Client',
            body
        );

        try {
            const { sendNotificationToUser } = require('../utils/push/notifications');
            await sendNotificationToUser(conversation.userId, {
                title: 'Nouveau message client',
                body: (conversation.clientName || 'Client') + ' : ' + body.slice(0, 80),
                icon: '/icons/icon-192x192.png',
                url: '/?tab=chat',
                tag: 'chat-' + conversation.id
            });
        } catch (pushErr) {
            console.warn('Erreur push chat:', pushErr.message);
        }

        if (process.env.RESEND_API_KEY) {
            try {
                const ownerResult = await pool.query(
                    'SELECT email FROM users WHERE id = $1',
                    [conversation.userId]
                );
                const ownerEmail = ownerResult.rows[0]?.email;

                if (ownerEmail) {
                    const resend = new Resend(process.env.RESEND_API_KEY);
                    const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');

                    await resend.emails.send({
                        from: process.env.RESEND_FROM_EMAIL || 'Chat client <noreply@votreentreprise.com>',
                        to: [ownerEmail],
                        subject: 'Nouveau message de ' + (conversation.clientName || 'un client'),
                        html: `
                            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                <h1 style="color:#0b1120;font-size:20px;margin-bottom:16px;">Nouveau message client</h1>
                                <p style="font-size:15px;line-height:1.6;">
                                    <strong>${conversation.clientName || 'Client'}</strong> vous a envoye un message.
                                </p>
                                <div style="background:#f6f9fc;border-left:3px solid #f97316;padding:14px 18px;margin:20px 0;border-radius:8px;">
                                    <p style="font-size:14px;color:#334155;margin:0;line-height:1.6;">${body.slice(0, 500)}</p>
                                </div>
                                <p style="text-align:center;margin:28px 0;">
                                    <a href="${baseUrl}/?tab=chat" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Repondre</a>
                                </p>
                            </div>
                        `
                    });
                }
            } catch (emailErr) {
                console.warn('Erreur envoi email:', emailErr.message);
            }
        }

        res.json({ success: true, message });
    } catch (err) {
        console.error('Erreur send public message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;