// backend/utils/assistant/memory/long-term.js
// Mémoire long terme via Supabase + pgvector.
// Stocke les conversations, devis, préférences pour recherche sémantique.

const { pool } = require('../../../db');
const llm = require('../llm/client');

const MAX_MEMORY_AGE_DAYS = 180;
const DEFAULT_WEIGHT = 1.0;

/**
 * Mémorise un événement dans la mémoire long terme.
 * @param {Object} opts
 * @param {number} opts.userId
 * @param {string} opts.memoryType - 'quote' | 'conversation' | 'preference' | 'pattern'
 * @param {string} opts.content - Texte à mémoriser
 * @param {Object} opts.metadata
 * @param {number} opts.weight
 */
async function remember({ userId, memoryType, content, metadata = {}, weight = DEFAULT_WEIGHT }) {
    if (!content || content.length < 5) return null;
    
    // Garde-fou : userId doit être un UUID valide
    // const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // if (!uuidRegex.test(String(userId))) {
    //     console.warn(`⚠️  [Memory] userId non-UUID ignoré : ${userId}`);
    //     return null;
    // }
    // const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // if (!uuidRegex.test(String(userId))) {
    //     console.warn(`⚠️  [Memory] userId non-UUID ignoré : ${userId}`);
    //     return memoryType === 'search' ? [] : null;
    // }
    // ⚠️ Garde-fou : userId doit être un entier valide (positif)
    if (!userId || typeof userId !== 'number' && !/^\d+$/.test(String(userId))) {
        console.warn(`⚠️  [Memory] userId invalide ignoré : ${userId}`);
        return null;
    }
    const userIdInt = parseInt(userId);

    try {
        // Générer l'embedding via Ollama
        const embedding = await llm.embed(content);
        const vectorLiteral = `[${embedding.join(',')}]`;

        const result = await pool.query(`
            INSERT INTO assistant_memory
                (user_id, memory_type, content, embedding, metadata, weight)
            VALUES ($1, $2, $3, $4::vector, $5, $6)
            RETURNING id
        `, [userId, memoryType, content.slice(0, 4000), vectorLiteral, JSON.stringify(metadata), weight]);

        console.log(`💾 [Memory] Mémorisé (${memoryType}) : ${content.slice(0, 60)}...`);
        return result.rows[0].id;
    } catch (err) {
        console.warn(`⚠️  [Memory] Échec remember : ${err.message}`);
        return null;
    }
}

/**
 * Recherche les mémoires les plus pertinentes pour un texte.
 * @param {string} query
 * @param {number} userId
 * @param {Object} opts
 * @param {number} opts.limit
 * @param {string} opts.memoryType
 * @param {number} opts.minSimilarity - 0 à 1 (1 = identique)
 * @returns {Promise<Array>}
 */
async function searchRelevant(query, userId, opts = {}) {
    if (!query || query.length < 3) return [];
    
    // Garde-fou : userId doit être un UUID valide
    // const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // if (!uuidRegex.test(String(userId))) {
    //     console.warn(`⚠️  [Memory] userId non-UUID ignoré : ${userId}`);
    //     return null;
    // }
    // const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // if (!uuidRegex.test(String(userId))) {
    //     console.warn(`⚠️  [Memory] userId non-UUID ignoré : ${userId}`);
    //     return memoryType === 'search' ? [] : null;
    // }
    if (!userId) return [];
    const userIdInt = parseInt(userId);
    
    const limit = Math.min(parseInt(opts.limit) || 5, 20);
    const memoryType = opts.memoryType || null;
    const minSimilarity = parseFloat(opts.minSimilarity) || 0.5;

    try {
        const embedding = await llm.embed(query);
        const vectorLiteral = `[${embedding.join(',')}]`;

        // Similarité cosinus : 1 - (embedding <=> query) 
        let sql = `
            SELECT id, memory_type, content, metadata, weight,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM assistant_memory
            WHERE user_id = $2
              AND created_at > NOW() - INTERVAL '${MAX_MEMORY_AGE_DAYS} days'
              AND 1 - (embedding <=> $1::vector) > $3
        `;
        const params = [vectorLiteral, userId, minSimilarity];

        if (memoryType) {
            params.push(memoryType);
            sql += ` AND memory_type = $${params.length}`;
        }

        sql += ` ORDER BY similarity DESC, weight DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await pool.query(sql, params);

        console.log(`🔍 [Memory] ${result.rows.length} mémoire(s) pertinente(s)`);
        return result.rows.map(r => ({
            id: r.id,
            memoryType: r.memory_type,
            content: r.content,
            metadata: r.metadata,
            similarity: parseFloat(r.similarity),
            weight: parseFloat(r.weight),
        }));
    } catch (err) {
        console.warn(`⚠️  [Memory] Échec searchRelevant : ${err.message}`);
        return [];
    }
}

/**
 * Met à jour le poids d'une mémoire (feedback utilisateur).
 */
async function updateWeight(memoryId, userId, weight) {
    try {
        await pool.query(
            `UPDATE assistant_memory SET weight = $1, updated_at = NOW()
             WHERE id = $2 AND user_id = $3`,
            [weight, memoryId, userId]
        );
        return true;
    } catch (err) {
        console.warn(`⚠️  [Memory] Échec updateWeight : ${err.message}`);
        return false;
    }
}

/**
 * Supprime les vieilles mémoires (à appeler périodiquement).
 */
async function cleanupOldMemories(userId) {
    try {
        const result = await pool.query(
            `DELETE FROM assistant_memory
             WHERE user_id = $1 AND created_at < NOW() - INTERVAL '${MAX_MEMORY_AGE_DAYS} days'`,
            [userId]
        );
        console.log(`🧹 [Memory] ${result.rowCount} mémoire(s) supprimée(s)`);
        return result.rowCount;
    } catch (err) {
        console.warn(`⚠️  [Memory] Échec cleanup : ${err.message}`);
        return 0;
    }
}

module.exports = {
    remember,
    searchRelevant,
    updateWeight,
    cleanupOldMemories,
};