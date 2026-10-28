// backend/utils/assistant/llm/training-collector.js
// Collecte les interactions pour le fine-tuning futur.
// Format : Together AI (messages JSONL).

const { pool } = require('../../../db');

/**
 * Collecte une interaction complète pour fine-tuning.
 * Appelé après chaque chat réussi.
 */
async function collect({ userId, userMessage, response, conversationHistory = [] }) {
    // Ne collecter que si le message est intéressant (pas juste "bonjour")
    if (!userMessage || userMessage.length < 5) return null;
    if (!response || !response.intent) return null;

    // Ne pas collecter les erreurs
    if (response.response && typeof response.response === 'string' && response.response.includes('Je n\'ai pas pu')) {
        return null;
    }

    try {
        // Construire le format messages pour Together AI
        const messages = [
            {
                role: 'system',
                content: buildSystemPrompt(),
            },
            ...conversationHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text,
            })),
            { role: 'user', content: userMessage },
            {
                role: 'assistant',
                content: typeof response.response === 'string'
                    ? response.response
                    : JSON.stringify(response.response),
            },
        ];

        const result = await pool.query(`
            INSERT INTO assistant_training_data
                (user_id, messages, source, quality_score)
            VALUES ($1, $2, 'auto', $3)
            RETURNING id
        `, [userId, JSON.stringify(messages), 1.0]);

        console.log(`📚 [Training] Exemple collecté #${result.rows[0].id}`);
        return result.rows[0].id;
    } catch (err) {
        console.warn(`⚠️  [Training] Échec collect : ${err.message}`);
        return null;
    }
}

/**
 * Collecte une confirmation réussie (feedback positif fort).
 */
async function collectConfirmation({ userId, draft, result }) {
    try {
        const messages = [
            { role: 'system', content: buildSystemPrompt() },
            {
                role: 'user',
                content: `Action demandée : ${draft.summary}`,
            },
            {
                role: 'assistant',
                content: `Action confirmée et exécutée avec succès : ${JSON.stringify(result).slice(0, 500)}`,
            },
        ];

        await pool.query(`
            INSERT INTO assistant_training_data
                (user_id, messages, source, quality_score)
            VALUES ($1, $2, 'corrected', 1.5)
        `, [userId, JSON.stringify(messages)]);

        console.log(`📚 [Training] Confirmation collectée (haute qualité)`);
    } catch (err) {
        console.warn(`⚠️  [Training] Échec collectConfirmation : ${err.message}`);
    }
}

/**
 * Enregistre un feedback utilisateur (rating 1-5 ou correction manuelle).
 */
async function recordFeedback({ userId, messageId, rating, correction }) {
    if (!messageId) return;
    try {
        const qualityScore = rating ? Math.max(0, Math.min(2.0, rating / 2.5)) : 1.0;

        if (correction) {
            // L'utilisateur a corrigé la réponse → haute valeur
            await pool.query(`
                UPDATE assistant_training_data
                SET messages = jsonb_set(messages, '{2,content}', $1::jsonb),
                    quality_score = 2.0,
                    source = 'corrected'
                WHERE id = $2 AND user_id = $3
            `, [JSON.stringify(correction), messageId, userId]);
            console.log(`📚 [Training] Correction enregistrée #${messageId}`);
        } else {
            await pool.query(`
                UPDATE assistant_training_data
                SET quality_score = $1
                WHERE id = $2 AND user_id = $3
            `, [qualityScore, messageId, userId]);
        }
    } catch (err) {
        console.warn(`⚠️  [Training] Échec feedback : ${err.message}`);
    }
}

/**
 * Exporte les données pour fine-tuning (format Together AI).
 */
async function exportForFineTuning(userId, opts = {}) {
    const minQuality = parseFloat(opts.minQuality) || 1.0;
    const limit = parseInt(opts.limit) || 10000;

    const result = await pool.query(`
        SELECT id, messages, quality_score
        FROM assistant_training_data
        WHERE user_id = $1
          AND quality_score >= $2
          AND used_for_training = FALSE
        ORDER BY quality_score DESC, created_at ASC
        LIMIT $3
    `, [userId, minQuality, limit]);

    return result.rows.map(r => ({
        messages: r.messages,
        // Together AI accepte un champ "weight" optionnel
        weight: Math.min(r.quality_score, 2.0),
    }));
}

/**
 * Marque les exemples comme utilisés pour l'entraînement.
 */
async function markAsUsed(ids) {
    if (!ids || ids.length === 0) return;
    await pool.query(`
        UPDATE assistant_training_data
        SET used_for_training = TRUE
        WHERE id = ANY($1::bigint[])
    `, [ids]);
}

function buildSystemPrompt() {
    return `Tu es Clara, l'assistante de Devis Express Pro, une application de gestion de devis/factures/stock/chantiers pour artisans et TPE. Tu réponds en français, de façon chaleureuse et concise.`;
}

module.exports = {
    collect,
    collectConfirmation,
    recordFeedback,
    exportForFineTuning,
    markAsUsed,
};