// backend/utils/assistant/llm/intent-learner.js
// Détecte des patterns d'apprentissage depuis l'historique utilisateur.

const { pool } = require('../../../db');
const llm = require('./client');
const prompts = require('./prompts');

/**
 * Analyse l'historique d'un utilisateur pour détecter des patterns.
 * À lancer périodiquement ou sur demande.
 */
async function analyzeHistory(userId) {
    // Charger les N derniers échanges
    const sessionResult = await pool.query(
        'SELECT recent_history FROM assistant_sessions WHERE user_id = $1',
        [userId]
    );

    const history = sessionResult.rows[0]?.recent_history || [];
    if (history.length < 5) {
        return { patterns: [], message: 'Pas assez d\'historique (min 5 messages).' };
    }

    const userMessages = history
        .filter(m => m.role === 'user')
        .map(m => m.text);

    if (userMessages.length < 3) {
        return { patterns: [], message: 'Pas assez de messages utilisateur.' };
    }

    try {
        const result = await llm.chatJSON({
            system: prompts.INTENT_LEARNER_SYSTEM,
            user: prompts.buildIntentLearnerUser({ history: userMessages }),
            tier: 'heavy',
            temperature: 0.3,
            maxTokens: 800,
        });

        const patterns = Array.isArray(result.patterns) ? result.patterns : [];
        console.log(`🧠 [Learner] ${patterns.length} pattern(s) détecté(s)`);

        // Sauvegarder les patterns dans la base
        const saved = [];
        for (const p of patterns) {
            const id = await saveLearning(userId, p);
            if (id) saved.push(id);
        }

        return { patterns, saved, message: `${patterns.length} pattern(s) détecté(s).` };
    } catch (err) {
        console.error(`❌ [Learner] Échec : ${err.message}`);
        return { patterns: [], error: err.message };
    }
}

/**
 * Sauvegarde un pattern (ou incrémente son compteur).
 */
async function saveLearning(userId, pattern) {
    if (!pattern.type || !pattern.observation) return null;

    try {
        const result = await pool.query(`
            INSERT INTO assistant_learnings
                (user_id, pattern_type, context, observation, confidence, count, status)
            VALUES ($1, $2, $3, $4, $5, 1, 'pending')
            ON CONFLICT (user_id, pattern_type, context)
            DO UPDATE SET
                count = assistant_learnings.count + 1,
                confidence = GREATEST(assistant_learnings.confidence, EXCLUDED.confidence),
                observation = EXCLUDED.observation,
                updated_at = NOW()
            RETURNING id, count, confidence
        `, [
            userId,
            pattern.type,
            pattern.context || null,
            JSON.stringify(pattern.observation),
            parseFloat(pattern.confidence) || 0.5,
        ]);

        return result.rows[0].id;
    } catch (err) {
        console.warn(`⚠️  [Learner] Échec save : ${err.message}`);
        return null;
    }
}

/**
 * Récupère les patterns avec confiance suffisante pour être proposés.
 */
async function getPendingLearnings(userId, opts = {}) {
    const minConfidence = parseFloat(opts.minConfidence) || 0.7;
    const minCount = parseInt(opts.minCount) || 3;

    const result = await pool.query(`
        SELECT id, pattern_type, context, observation, confidence, count, created_at
        FROM assistant_learnings
        WHERE user_id = $1
          AND status = 'pending'
          AND confidence >= $2
          AND count >= $3
        ORDER BY confidence DESC, count DESC
        LIMIT 10
    `, [userId, minConfidence, minCount]);

    return {
        count: result.rows.length,
        learnings: result.rows.map(r => ({
            id: r.id,
            type: r.pattern_type,
            context: r.context,
            observation: r.observation,
            confidence: parseFloat(r.confidence),
            count: r.count,
        })),
    };
}

/**
 * Applique un pattern : convertit en préférence utilisateur.
 */
async function applyLearning(userId, learningId) {
    const result = await pool.query(
        'SELECT * FROM assistant_learnings WHERE id = $1 AND user_id = $2',
        [learningId, userId]
    );

    if (result.rows.length === 0) throw new Error('Pattern introuvable.');

    const learning = result.rows[0];
    const obs = learning.observation;
    const { updateUserPreferences, getUserPreferences } = require('../../assistant/preferences');

    const updates = {};

    switch (learning.pattern_type) {
        case 'preference': {
            if (obs.key && obs.value !== undefined) {
                updates[obs.key] = obs.value;
            }
            break;
        }
        case 'voice_correction': {
            if (obs.wrong && obs.correct) {
                const prefs = await getUserPreferences(userId);
                prefs.voiceCorrections[obs.wrong] = obs.correct;
                updates.voiceCorrections = prefs.voiceCorrections;
            }
            break;
        }
        case 'hourly_rate': {
            if (obs.context && obs.rate !== undefined) {
                const prefs = await getUserPreferences(userId);
                prefs.hourlyRates[obs.context] = obs.rate;
                updates.hourlyRates = prefs.hourlyRates;
            }
            break;
        }
        default:
            throw new Error(`Type de pattern non supporté : ${learning.pattern_type}`);
    }

    if (Object.keys(updates).length === 0) {
        throw new Error('Aucune mise à jour à appliquer.');
    }

    const ok = await updateUserPreferences(userId, updates);
    if (!ok) throw new Error('Impossible d\'appliquer la préférence.');

    await pool.query(
        'UPDATE assistant_learnings SET status = \'applied\', updated_at = NOW() WHERE id = $1',
        [learningId]
    );

    return { applied: true, updates };
}

/**
 * Rejette un pattern (ne plus le proposer).
 */
async function dismissLearning(userId, learningId) {
    await pool.query(
        'UPDATE assistant_learnings SET status = \'dismissed\', updated_at = NOW() WHERE id = $1 AND user_id = $2',
        [learningId, userId]
    );
}

module.exports = {
    analyzeHistory,
    saveLearning,
    getPendingLearnings,
    applyLearning,
    dismissLearning,
};