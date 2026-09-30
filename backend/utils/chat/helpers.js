// backend/utils/chat/helpers.js
// Logique metier du chat client

const crypto = require('crypto');
const { pool } = require('../../db');

// ------------------------------------------------------------
// Genere un token d'acces public a une conversation
// ------------------------------------------------------------
function generateAccessToken() {
    return crypto.randomBytes(24).toString('hex');
}

// ------------------------------------------------------------
// Cree ou recupere une conversation pour un client (par contexte)
// ------------------------------------------------------------
async function getOrCreateConversation(userId, data) {
    const { clientId, clientName, clientEmail, subject, relatedQuoteId, relatedInvoiceId, relatedChantierId } = data;

    let query = 'SELECT * FROM client_conversations WHERE user_id = $1 AND status = \'open\'';
    const params = [userId];

    if (clientId) {
        params.push(clientId);
        query += ' AND client_id = $' + params.length;
    } else if (clientEmail) {
        params.push(clientEmail.toLowerCase());
        query += ' AND LOWER(client_email) = $' + params.length;
    }

    if (relatedQuoteId) {
        params.push(relatedQuoteId);
        query += ' AND related_quote_id = $' + params.length;
    } else if (relatedInvoiceId) {
        params.push(relatedInvoiceId);
        query += ' AND related_invoice_id = $' + params.length;
    } else if (relatedChantierId) {
        params.push(relatedChantierId);
        query += ' AND related_chantier_id = $' + params.length;
    }

    query += ' ORDER BY last_message_at DESC LIMIT 1';

    const existing = await pool.query(query, params);

    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    const token = generateAccessToken();

    const result = await pool.query(`
        INSERT INTO client_conversations (
            user_id, client_id, client_name, client_email, subject,
            related_quote_id, related_invoice_id, related_chantier_id,
            access_token
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    `, [
        userId,
        clientId || null,
        clientName || null,
        clientEmail || null,
        subject || null,
        relatedQuoteId || null,
        relatedInvoiceId || null,
        relatedChantierId || null,
        token
    ]);

    return result.rows[0];
}

// ------------------------------------------------------------
// Liste les conversations visibles par un client
// ------------------------------------------------------------
async function getClientConversations(userId, clientId, clientEmail) {
    let query = `
        SELECT c.*,
               q.quote_number,
               i.invoice_number,
               ch.name as chantier_name,
               (SELECT COUNT(*) FROM client_messages m WHERE m.conversation_id = c.id) as messages_count,
               (SELECT body FROM client_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_body
        FROM client_conversations c
        LEFT JOIN quotes q ON q.id = c.related_quote_id
        LEFT JOIN invoices i ON i.id = c.related_invoice_id
        LEFT JOIN chantiers ch ON ch.id = c.related_chantier_id
        WHERE c.user_id = $1
    `;
    const params = [userId];

    // Match par clientId OU clientEmail
    if (clientId && clientEmail) {
        params.push(clientId);
        const idx1 = params.length;
        params.push(clientEmail.toLowerCase());
        const idx2 = params.length;
        query += ' AND (c.client_id = $' + idx1 + ' OR LOWER(c.client_email) = $' + idx2 + ')';
    } else if (clientId) {
        params.push(clientId);
        query += ' AND c.client_id = $' + params.length;
    } else if (clientEmail) {
        params.push(clientEmail.toLowerCase());
        query += ' AND LOWER(c.client_email) = $' + params.length;
    } else {
        return [];
    }

    query += ' ORDER BY c.last_message_at DESC';

    const result = await pool.query(query, params);

    return result.rows.map(c => ({
        id: c.id,
        subject: c.subject,
        relatedQuoteId: c.related_quote_id,
        relatedInvoiceId: c.related_invoice_id,
        relatedChantierId: c.related_chantier_id,
        quoteNumber: c.quote_number,
        invoiceNumber: c.invoice_number,
        chantierName: c.chantier_name,
        lastMessageAt: c.last_message_at,
        lastMessagePreview: c.last_message_preview,
        lastBody: c.last_body,
        clientUnreadCount: c.client_unread_count || 0,
        messagesCount: parseInt(c.messages_count) || 0,
        status: c.status,
        accessToken: c.access_token,
        createdAt: c.created_at
    }));
}

// ------------------------------------------------------------
// Ajoute un message a une conversation
// ------------------------------------------------------------
async function addMessage(conversationId, senderType, senderName, body) {
    if (!body || !body.trim()) {
        throw new Error('Le message ne peut pas etre vide.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(`
            INSERT INTO client_messages (conversation_id, sender_type, sender_name, body)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [conversationId, senderType, senderName || null, body.trim()]);

        const preview = body.trim().slice(0, 100);

        if (senderType === 'client') {
            await client.query(`
                UPDATE client_conversations
                SET last_message_at = NOW(),
                    last_message_preview = $1,
                    owner_unread_count = owner_unread_count + 1,
                    updated_at = NOW()
                WHERE id = $2
            `, [preview, conversationId]);
        } else {
            await client.query(`
                UPDATE client_conversations
                SET last_message_at = NOW(),
                    last_message_preview = $1,
                    client_unread_count = client_unread_count + 1,
                    updated_at = NOW()
                WHERE id = $2
            `, [preview, conversationId]);
        }

        await client.query('COMMIT');

        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Charge les messages d'une conversation
// ------------------------------------------------------------
async function getMessages(conversationId, limit = 200) {
    const result = await pool.query(`
        SELECT * FROM client_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
        LIMIT $2
    `, [conversationId, limit]);

    return result.rows.map(m => ({
        id: m.id,
        senderType: m.sender_type,
        senderName: m.sender_name,
        body: m.body,
        readAt: m.read_at,
        createdAt: m.created_at
    }));
}

// ------------------------------------------------------------
// Marque les messages comme lus (cote proprietaire)
// ------------------------------------------------------------
async function markAsReadByOwner(conversationId, userId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE client_messages
            SET read_at = NOW()
            WHERE conversation_id = $1 AND sender_type = 'client' AND read_at IS NULL
        `, [conversationId]);

        await client.query(`
            UPDATE client_conversations
            SET owner_unread_count = 0
            WHERE id = $1 AND user_id = $2
        `, [conversationId, userId]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Marque les messages comme lus (cote client)
// ------------------------------------------------------------
async function markAsReadByClient(conversationId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE client_messages
            SET read_at = NOW()
            WHERE conversation_id = $1 AND sender_type = 'owner' AND read_at IS NULL
        `, [conversationId]);

        await client.query(`
            UPDATE client_conversations
            SET client_unread_count = 0
            WHERE id = $1
        `, [conversationId]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ------------------------------------------------------------
// Liste des conversations pour un proprietaire
// ------------------------------------------------------------
async function listConversations(userId, filter) {
    let query = `
        SELECT c.*,
               (SELECT COUNT(*) FROM client_messages m WHERE m.conversation_id = c.id) as messages_count,
               q.quote_number as quote_number,
               i.invoice_number as invoice_number,
               ch.name as chantier_name
        FROM client_conversations c
        LEFT JOIN quotes q ON q.id = c.related_quote_id
        LEFT JOIN invoices i ON i.id = c.related_invoice_id
        LEFT JOIN chantiers ch ON ch.id = c.related_chantier_id
        WHERE c.user_id = $1
    `;
    const params = [userId];

    if (filter === 'unread') {
        query += ' AND c.owner_unread_count > 0';
    } else if (filter === 'open') {
        query += ' AND c.status = \'open\'';
    } else if (filter === 'closed') {
        query += ' AND c.status = \'closed\'';
    }

    query += ' ORDER BY c.last_message_at DESC LIMIT 200';

    const result = await pool.query(query, params);

    return result.rows.map(c => ({
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
        lastMessageAt: c.last_message_at,
        lastMessagePreview: c.last_message_preview,
        ownerUnreadCount: c.owner_unread_count || 0,
        clientUnreadCount: c.client_unread_count || 0,
        status: c.status,
        accessToken: c.access_token,
        messagesCount: parseInt(c.messages_count) || 0,
        createdAt: c.created_at
    }));
}

// ------------------------------------------------------------
// Verifie qu'un token d'acces est valide
// ------------------------------------------------------------
async function getConversationByToken(token) {
    const result = await pool.query(`
        SELECT c.*, s.company_name, s.logo as company_logo
        FROM client_conversations c
        LEFT JOIN settings s ON s.user_id = c.user_id
        WHERE c.access_token = $1
    `, [token]);

    if (result.rows.length === 0) return null;

    const c = result.rows[0];
    return {
        id: c.id,
        userId: c.user_id,
        clientId: c.client_id,
        clientName: c.client_name,
        clientEmail: c.client_email,
        subject: c.subject,
        relatedQuoteId: c.related_quote_id,
        relatedInvoiceId: c.related_invoice_id,
        relatedChantierId: c.related_chantier_id,
        status: c.status,
        clientUnreadCount: c.client_unread_count || 0,
        companyName: c.company_name,
        companyLogo: c.company_logo
    };
}

module.exports = {
    generateAccessToken,
    getOrCreateConversation,
    addMessage,
    getMessages,
    markAsReadByOwner,
    markAsReadByClient,
    listConversations,
    getConversationByToken,
    getClientConversations
};