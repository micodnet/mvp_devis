// backend/utils/assistant/agents/conversational-agent.js
// Agent 5 : Génération de la réponse finale en langage naturel.
// Reçoit les résultats bruts et les transforme en message humain.

const llm = require('../llm/client');
const prompts = require('../llm/prompts');

/**
 * Génère une réponse naturelle.
 * @param {Object} opts
 * @param {string} opts.message - Message original de l'utilisateur
 * @param {string} opts.intent - Catégorie d'intention
 * @param {Array} opts.taskResults - Résultats des tâches exécutées
 * @param {Object} opts.session - Contexte de session
 * @returns {Promise<string>} Message formaté
 */
async function respond({ message, intent, taskResults = [], session = null }) {
    if (!message) return 'Je n\'ai pas compris votre demande.';

    // Extraire les données utiles des résultats
    const data = extractDataFromResults(taskResults);

    // Construire le contexte
    const context = buildContext(session, intent);

    try {
        const response = await llm.chat({
            system: prompts.CONVERSATIONAL_SYSTEM,
            user: prompts.buildConversationalUser({ message, context, data }),
            tier: 'heavy',
            temperature: 0.4,
            maxTokens: 800,
        });

        return response.trim();
    } catch (err) {
        console.warn(`⚠️  [Conversational] Échec LLM : ${err.message}`);

        // Fallback : réponse simple basée sur les données
        if (data) {
            return formatFallback(data);
        }
        return 'Je n\'ai pas pu formuler de réponse. Réessayez.';
    }
}

/**
 * Extrait les données significatives des résultats de tâches.
 */
function extractDataFromResults(taskResults) {
    if (!Array.isArray(taskResults) || taskResults.length === 0) return null;

    // Fusionner tous les résultats en un seul objet
    const merged = {};
    for (const tr of taskResults) {
        if (!tr || !tr.result) continue;
        // Prioriser le résultat le plus riche
        if (tr.result.count !== undefined || tr.result.quotes || tr.result.clients || tr.result.products || tr.result.services || tr.result.invoices || tr.result.alerts) {
            Object.assign(merged, tr.result);
        } else if (tr.result.matches) {
            merged.matches = tr.result.matches;
        } else if (tr.result.subtotal !== undefined) {
            merged.calculation = tr.result;
        }
    }

    return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Construit un contexte textuel pour le LLM.
 */
function buildContext(session, intent) {
    const parts = [];
    if (intent) parts.push(`Intention : ${intent}`);
    if (session) {
        if (session.lastQuoteNumber) parts.push(`Dernier devis : ${session.lastQuoteNumber}`);
        if (session.lastClientName) parts.push(`Dernier client : ${session.lastClientName}`);
    }
    return parts.join('\n');
}

/**
 * Fallback basique si le LLM échoue.
 */
function formatFallback(data) {
    if (data.count !== undefined && data.quotes) {
        return `Vous avez ${data.count} devis.`;
    }
    if (data.count !== undefined && data.clients) {
        return `Vous avez ${data.count} clients.`;
    }
    if (data.count !== undefined && data.products) {
        return `Vous avez ${data.count} produits.`;
    }
    if (data.total !== undefined) {
        return `Résultat : ${JSON.stringify(data).slice(0, 200)}`;
    }
    return 'Voici les données demandées.';
}

module.exports = { respond };