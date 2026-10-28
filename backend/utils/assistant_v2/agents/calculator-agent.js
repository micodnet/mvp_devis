// backend/utils/assistant/agents/calculator-agent.js
// Agent 3 : Calcul métier. Déterministe (aucun LLM).
// Prépare les données, appelle les compute-tools, applique les préférences.

const computeTools = require('../tools/compute-tools');

/**
 * Calcule un devis à partir d'une description.
 * @param {Object} args - { description, clientName? }
 * @param {number} userId
 * @param {Object} context - { userPrefs }
 * @returns {Promise<Object>} { type, metier(s), items, heures, subtotal, logs }
 */
async function calculate(args, userId, context = {}) {
    if (!args.description) {
        return { error: 'Description manquante pour le calcul.' };
    }

    const result = await computeTools.calculateAuto(userId, args, context);

    if (result.error) {
        console.warn(`⚠️  [Calculator] ${result.error}`);
        return result;
    }

    console.log(`🧮 [Calculator] ${result.type} → ${result.items.length} lignes, ${result.heures}h, ${result.subtotal}€`);

    // Enrichir avec le client si fourni
    if (args.clientName) {
        result.clientName = args.clientName;
    }

    return result;
}

/**
 * Détecte juste le métier (sans calculer).
 */
async function detect(args, userId) {
    return await computeTools.detectMetier(userId, args);
}

module.exports = { calculate, detect };