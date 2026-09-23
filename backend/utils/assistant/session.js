// backend/utils/assistant/session.js
// Gère la mémoire de session de l'assistant (dernier devis, dernier client, ...)

const { pool } = require('../../db');

// ------------------------------------------------------------
// Charge la session active d'un utilisateur (crée si inexistante)
// ------------------------------------------------------------
async function getSession(userId) {
    try {
        const result = await pool.query(
            'SELECT * FROM assistant_sessions WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            await pool.query(
                'INSERT INTO assistant_sessions (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
                [userId]
            );
            return {
                lastQuoteId: null,
                lastQuoteNumber: null,
                lastClientName: null,
                lastAction: null,
                lastActionAt: null,
                context: {},
                recentHistory: []
            };
        }
        const row = result.rows[0];
        return {
            lastQuoteId: row.last_quote_id,
            lastQuoteNumber: row.last_quote_number,
            lastClientName: row.last_client_name,
            lastAction: row.last_action,
            lastActionAt: row.last_action_at,
            context: row.context || {},
            recentHistory: row.recent_history || []
        };
    } catch (err) {
        console.error('Erreur getSession:', err.message);
        return {
            lastQuoteId: null, lastQuoteNumber: null, lastClientName: null,
            lastAction: null, lastActionAt: null, context: {}, recentHistory: []
        };
    }
}

// ------------------------------------------------------------
// Met à jour la session après une action
// ------------------------------------------------------------
async function updateSession(userId, updates) {
    try {
        await pool.query(
            'INSERT INTO assistant_sessions (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [userId]
        );

        const allowedFields = {
            lastQuoteId: 'last_quote_id',
            lastQuoteNumber: 'last_quote_number',
            lastClientName: 'last_client_name',
            lastAction: 'last_action',
            context: 'context',
            recentHistory: 'recent_history'
        };

        const fields = [];
        const values = [];
        let idx = 1;

        for (const [key, val] of Object.entries(updates)) {
            const col = allowedFields[key];
            if (!col) continue;
            fields.push(`${col} = $${idx}`);
            values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
            idx++;
        }

        // Toujours mettre à jour last_action_at si last_action fourni
        if (updates.lastAction) {
            fields.push(`last_action_at = NOW()`);
        }

        if (fields.length === 0) return false;

        values.push(userId);
        await pool.query(`
            UPDATE assistant_sessions
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE user_id = $${idx}
        `, values);

        return true;
    } catch (err) {
        console.error('Erreur updateSession:', err.message);
        return false;
    }
}

// ------------------------------------------------------------
// Enregistre une action dans l'historique récent (max 5)
// ------------------------------------------------------------
async function recordExchange(userId, role, text) {
    try {
        const session = await getSession(userId);
        const history = Array.isArray(session.recentHistory) ? session.recentHistory : [];
        history.push({ role, text: String(text).slice(0, 300), at: new Date().toISOString() });
        // Garder les 5 derniers
        const trimmed = history.slice(-5);
        await updateSession(userId, { recentHistory: trimmed });
    } catch (err) {
        console.error('Erreur recordExchange:', err.message);
    }
}

// ------------------------------------------------------------
// Enregistre une action exécutée (création/modif de devis)
// ------------------------------------------------------------
async function recordAction(userId, action, metadata = {}) {
    const updates = { lastAction: action };
    if (metadata.quoteId) updates.lastQuoteId = metadata.quoteId;
    if (metadata.quoteNumber) updates.lastQuoteNumber = metadata.quoteNumber;
    if (metadata.clientName) updates.lastClientName = metadata.clientName;

    // Mettre à jour le contexte libre
    if (metadata.context) {
        const session = await getSession(userId);
        updates.context = { ...session.context, ...metadata.context };
    }

    await updateSession(userId, updates);
}

// ------------------------------------------------------------
// Réinitialise la session (ex : après logout ou commande "reset")
// ------------------------------------------------------------
async function resetSession(userId) {
    try {
        await pool.query(
            `UPDATE assistant_sessions
             SET last_quote_id = NULL,
                 last_quote_number = NULL,
                 last_client_name = NULL,
                 last_action = NULL,
                 context = '{}'::jsonb,
                 recent_history = '[]'::jsonb,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [userId]
        );
        return true;
    } catch (err) {
        console.error('Erreur resetSession:', err.message);
        return false;
    }
}

// ------------------------------------------------------------
// Construit un résumé compact pour le prompt du routeur
// ------------------------------------------------------------
function buildSessionSummary(session) {
    if (!session) return '';
    const parts = [];
    if (session.lastQuoteNumber) {
        parts.push(`Dernier devis : ${session.lastQuoteNumber}${session.lastClientName ? ` (client : ${session.lastClientName})` : ''}`);
    }
    if (session.lastAction) {
        parts.push(`Dernière action : ${session.lastAction}`);
    }
    if (session.context && session.context.pendingQuestion) {
        parts.push(`Question en attente : "${session.context.pendingQuestion}"`);
    }
    return parts.length > 0 ? `Session active :\n- ${parts.join('\n- ')}` : '';
}

module.exports = {
    getSession,
    updateSession,
    recordExchange,
    recordAction,
    resetSession,
    buildSessionSummary
};