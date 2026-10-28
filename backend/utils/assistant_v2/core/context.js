// backend/utils/assistant/core/context.js
// Charge le contexte complet : session, préférences, mémoire long terme.
// Un seul appel, tout est prêt pour le Planner.

const { getSession } = require('../../assistant/session');
const { getUserPreferences } = require('../../assistant/preferences');

/**
 * Charge le contexte utilisateur.
 * @param {number} userId
 * @param {Array} conversationHistory - Historique fourni par le client
 * @returns {Promise<Object>}
 */
async function loadContext(userId, conversationHistory = []) {
    const [session, userPrefs] = await Promise.all([
        getSession(userId).catch(err => {
            console.warn(`⚠️  [Context] getSession échec : ${err.message}`);
            return null;
        }),
        getUserPreferences(userId).catch(err => {
            console.warn(`⚠️  [Context] getUserPreferences échec : ${err.message}`);
            return null;
        }),
    ]);

    return {
        session,
        userPrefs,
        conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
        // Sera enrichi par la mémoire long terme (Lot 4 - memory.js)
        relevantMemories: [],
    };
}

/**
 * Construit un résumé textuel du contexte pour le Planner.
 */
function buildContextSummary(context) {
    const parts = [];

    if (context.session) {
        const s = context.session;
        if (s.lastQuoteNumber) {
            parts.push(`Dernier devis : ${s.lastQuoteNumber}${s.lastClientName ? ` (client : ${s.lastClientName})` : ''}`);
        }
        if (s.lastAction) parts.push(`Dernière action : ${s.lastAction}`);
        if (s.context?.pendingQuestion) parts.push(`Question en attente : "${s.context.pendingQuestion}"`);
    }

    if (context.userPrefs) {
        const p = context.userPrefs;
        if (p.defaultHourlyRate) parts.push(`Taux horaire défaut : ${p.defaultHourlyRate}€/h`);
        if (p.defaultMarginPercent > 0) parts.push(`Marge défaut : ${p.defaultMarginPercent}%`);
        if (p.defaultVatRegime) parts.push(`Régime TVA : ${p.defaultVatRegime}`);
    }

    if (context.relevantMemories?.length > 0) {
        parts.push('Mémoire pertinente :');
        for (const mem of context.relevantMemories.slice(0, 3)) {
            parts.push(`  • ${String(mem.content).slice(0, 120)}`);
        }
    }

    return parts.length > 0 ? parts.join('\n') : 'Aucun contexte particulier.';
}

module.exports = { loadContext, buildContextSummary };