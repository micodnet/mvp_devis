// backend/utils/assistant/core/orchestrator.js
// Orchestrateur principal : point d'entrée de l'assistant V2.
// Boucle : context → intent → planner → executor → conversational

const intentAgent = require('../agents/intent-agent');
const conversationalAgent = require('../agents/conversational-agent');
const calculatorAgent = require('../agents/calculator-agent');
const planner = require('./planner');
const executor = require('./executor');
const { loadContext, buildContextSummary } = require('./context');
const { recordExchange, recordAction } = require('../../assistant/session');
const longTerm = require('../memory/long-term');
const { executeLegacyAction } = require('../tools/write-tools');

/**
 * Point d'entrée principal.
 * @param {string} userMessage
 * @param {number} userId
 * @param {Array} conversationHistory
 * @returns {Promise<Object>}
 */
async function chat(userMessage, userId, conversationHistory = []) {
    const startedAt = Date.now();

    if (!userMessage || !userMessage.trim()) {
        return { response: 'Message vide.', intent: 'chat', hasData: false, durationMs: 0 };
    }

    // 1. Enregistrer le message dans la session
    try { await recordExchange(userId, 'user', userMessage); } catch (e) { /* silent */ }

    // 2. Charger le contexte complet
    const context = await loadContext(userId, conversationHistory);

    // 3. Enrichir avec la mémoire long terme (recherche sémantique)
    try {
        const memories = await longTerm.searchRelevant(userMessage, userId, { limit: 3 });
        context.relevantMemories = memories;
    } catch (err) {
        console.warn(`⚠️  [Orchestrator] Mémoire indisponible : ${err.message}`);
    }

    // 4. Classifier l'intention
    const sessionSummary = buildContextSummary(context);
    const intent = await intentAgent.classify({ message: userMessage, sessionSummary });

    // 5. Cas spécial : CALCUL → passer directement par le calculator, pas de plan
    if (intent.category === 'CALCUL' && intent.confidence > 0.7) {
        return await handleDirectCalculation(userMessage, userId, context, startedAt);
    }

    // 6. Planifier
    const plan = await planner.plan({
        message: userMessage,
        context,
        intentCategory: intent.category,
    });

    // 7. Exécuter
    const { results, pendingAction, errors } = await executor.execute(plan, userId, context);

    // 8. Si pendingAction → demander confirmation
    if (pendingAction) {
        return await handlePendingAction({
            pendingAction,
            userMessage,
            userId,
            context,
            startedAt,
        });
    }

    // 9. Si erreurs critiques → les remonter
    if (errors.length > 0 && Object.keys(results).length === 0) {
        const errorMsg = errors.map(e => e.error).join(' ; ');
        return {
            response: `Je n'ai pas pu exécuter votre demande : ${errorMsg}`,
            intent: intent.category,
            hasData: false,
            durationMs: Date.now() - startedAt,
            errors,
        };
    }

    // 10. Formater la réponse finale
    const taskResults = Object.entries(results).map(([id, r]) => ({ id: parseInt(id), ...r }));
    const response = await conversationalAgent.respond({
        message: userMessage,
        intent: intent.category,
        taskResults,
        session: context.session,
    });

    // 11. Enregistrer la réponse dans la session
    try { await recordExchange(userId, 'assistant', response); } catch (e) { /* silent */ }

    // 12. Mémoriser dans la mémoire long terme (async, non-bloquant)
    longTerm.remember({
        userId,
        memoryType: 'conversation',
        content: `User: ${userMessage}\nAssistant: ${response}`,
        metadata: { intent: intent.category, tasks: plan.tasks.length },
    }).catch(() => { /* silent */ });

    return {
        response,
        intent: intent.category,
        hasData: taskResults.length > 0,
        durationMs: Date.now() - startedAt,
        plan: plan.reasoning,
        tasksExecuted: plan.tasks.length,
    };
}

/**
 * Cas spécial : demande de calcul → pas de planification.
 */
async function handleDirectCalculation(userMessage, userId, context, startedAt) {
    const calc = await calculatorAgent.calculate(
        { description: userMessage },
        userId,
        { userPrefs: context.userPrefs }
    );

    if (calc.error) {
        return {
            response: `Je n'ai pas pu calculer : ${calc.error}`,
            intent: 'CALCUL',
            hasData: false,
            durationMs: Date.now() - startedAt,
        };
    }

    // Créer un brouillon de devis
    const draft = {
        type: 'create_quote',
        summary: `Créer un devis ${calc.metier || 'chantier'} (${calc.items.length} lignes, ${calc.heures}h)`,
        preview: {
            'Métier détecté': calc.metier || (calc.metiers ? calc.metiers.join(', ') : '—'),
            'Surface / Volume': calc.surface ? `${calc.surface} m²` : '—',
            'Temps total': `${calc.heures} h`,
            'Nombre de lignes': calc.items.length,
            'Total HT': `${calc.subtotal.toFixed(2)} €`,
        },
        payload: {
            clientName: 'Client à préciser',
            items: calc.items,
            vatRegime: context.userPrefs?.defaultVatRegime || 'franchise',
            vatRate: context.userPrefs?.defaultVatRate || 21,
            logs: calc.logs,
        },
    };

    return {
        response: buildDraftMessage(draft),
        isPendingAction: true,
        draft,
        intent: 'CALCUL',
        hasData: true,
        durationMs: Date.now() - startedAt,
    };
}

/**
 * Gère une action en attente (confirmation ou question).
 */
async function handlePendingAction({ pendingAction, userMessage, userId, context, startedAt }) {
    if (pendingAction.kind === 'ask_user') {
        return {
            response: pendingAction.question,
            isPendingAction: true,
            pendingKind: 'ask_user',
            intent: 'CONVERSATION',
            hasData: false,
            durationMs: Date.now() - startedAt,
        };
    }

    if (pendingAction.kind === 'confirm_action') {
        return {
            response: buildDraftMessage(pendingAction.draft),
            isPendingAction: true,
            pendingKind: 'confirm_action',
            draft: pendingAction.draft,
            intent: 'ECRITURE',
            hasData: true,
            durationMs: Date.now() - startedAt,
        };
    }

    return {
        response: 'Action en attente non reconnue.',
        intent: 'CONVERSATION',
        hasData: false,
        durationMs: Date.now() - startedAt,
    };
}

/**
 * Formate un brouillon en message lisible.
 */
function buildDraftMessage(draft) {
    let text = `Je vais effectuer l'action suivante :\n\n**${draft.summary}**\n\n`;
    for (const [key, val] of Object.entries(draft.preview || {})) {
        text += `• ${key} : ${val}\n`;
    }
    text += `\nCliquez sur **Confirmer** pour valider ou **Annuler** pour abandonner.`;
    return text;
}

/**
 * Confirme et exécute une action en attente.
 * Appelé depuis la route /api/assistant/v2/confirm
 */
async function confirmAction(draft, userId) {
    if (!draft || !draft.type) throw new Error('Brouillon invalide.');

    const result = await executeLegacyAction(draft.type, draft.payload, userId);

    // Enregistrer dans la session
    try {
        await recordAction(userId, draft.type, {
            quoteId: result.id,
            quoteNumber: result.quoteNumber,
            clientName: draft.payload?.clientName,
        });
    } catch (e) { /* silent */ }

    // Mémoriser l'action dans la mémoire long terme
    longTerm.remember({
        userId,
        memoryType: 'quote',
        content: `${draft.type} : ${draft.summary}`,
        metadata: { draft: draft.type, result },
    }).catch(() => { /* silent */ });

    return result;
}

module.exports = { chat, confirmAction };