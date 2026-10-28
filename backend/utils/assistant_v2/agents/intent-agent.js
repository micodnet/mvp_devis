// backend/utils/assistant/agents/intent-agent.js
// Agent 1 : Classification de l'intention en grande catégorie.
// Utilise un petit modèle rapide.

const llm = require('../llm/client');
const prompts = require('../llm/prompts');

/**
 * Classifie l'intention utilisateur.
 * @returns {Promise<{category, confidence, domain, needs_clarification}>}
 */
async function classify({ message, sessionSummary = '' }) {
    if (!message || typeof message !== 'string') {
        return { category: 'CONVERSATION', confidence: 0.5, domain: null, needs_clarification: false };
    }

    // Heuristique rapide pour les cas évidents (économie d'appel LLM)
    const quick = quickHeuristic(message);
    if (quick) {
        console.log(`🎯 [Intent] Heuristique → ${quick.category}`);
        return quick;
    }

    try {
        const result = await llm.chatJSON({
            system: prompts.INTENT_SYSTEM,
            user: prompts.buildIntentUser({ message, sessionSummary }),
            tier: 'light',
            temperature: 0.1,
            maxTokens: 200,
        });

        console.log(`🎯 [Intent] LLM → ${result.category} (${result.confidence})`);
        return {
            category: result.category || 'CONVERSATION',
            confidence: parseFloat(result.confidence) || 0.5,
            domain: result.domain || null,
            needs_clarification: !!result.needs_clarification,
        };
    } catch (err) {
        console.warn(`⚠️  [Intent] Échec LLM : ${err.message}, fallback CONVERSATION`);
        return { category: 'CONVERSATION', confidence: 0.3, domain: null, needs_clarification: false };
    }
}

/**
 * Heuristique ultra-rapide pour les cas évidents.
 */
function quickHeuristic(message) {
    const m = message.trim().toLowerCase();

    // Salutations
    if (/^(bonjour|salut|hello|hi|coucou|bonsoir|hey)[\s!.,?]*$/i.test(m)) {
        return { category: 'CONVERSATION', confidence: 0.99, domain: 'general', needs_clarification: false };
    }

    // Aide
    if (/^(aide|help|que peux[- ]tu faire|tu sais faire quoi)/i.test(m)) {
        return { category: 'CONVERSATION', confidence: 0.95, domain: 'general', needs_clarification: false };
    }

    // Calcul métier (mots-clés de métier)
    const metierKeywords = /\b(peindre|peinture|carrelage|carreler|placo|plaque|parquet|plafond|isolation|toiture|maçonnerie|parpaing|électricité|plomberie|terrassement|cloison)\b/i;
    if (metierKeywords.test(m) && /\d/.test(m)) {
        return { category: 'CALCUL', confidence: 0.85, domain: 'devis', needs_clarification: false };
    }

    return null;
}

module.exports = { classify };