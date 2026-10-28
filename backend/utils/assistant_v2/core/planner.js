// backend/utils/assistant/core/planner.js
// Décompose la demande utilisateur en tâches atomiques via LLM.

const llm = require('../llm/client');
const prompts = require('../llm/prompts');
const { buildToolsCatalog, getToolNames } = require('../tools/registry');
const { buildContextSummary } = require('./context');

/**
 * Planifie une demande utilisateur.
 * @param {Object} opts
 * @param {string} opts.message - Message original
 * @param {Object} opts.context - Contexte chargé (session, prefs, memories)
 * @param {string} opts.intentCategory - LECTURE | ECRITURE | CALCUL | CONVERSATION
 * @returns {Promise<{reasoning: string, tasks: Array}>}
 */
async function plan({ message, context, intentCategory }) {
    // Cas trivial : conversation → pas besoin de plan complexe
    if (intentCategory === 'CONVERSATION') {
        return {
            reasoning: 'Demande conversationnelle, pas de plan nécessaire.',
            tasks: [{ id: 1, tool: 'respond', args: { message }, depends_on: [] }],
        };
    }

    const toolsCatalog = buildToolsCatalog();
    const sessionSummary = buildContextSummary(context);

    try {
        const result = await llm.chatJSON({
            system: prompts.PLANNER_SYSTEM,
            user: prompts.buildPlannerUser({
                message,
                context,
                toolsCatalog,
                sessionSummary,
            }),
            tier: 'heavy',
            temperature: 0.1,
            maxTokens: 1200,
        });

        // Validation du plan
        const plan = validatePlan(result);
        console.log(`📋 [Planner] ${plan.tasks.length} tâche(s) planifiée(s)`);
        for (const t of plan.tasks) {
            console.log(`   ${t.id}. ${t.tool} ${t.critical ? '[CRITIQUE]' : ''} ← ${JSON.stringify(t.args).slice(0, 80)}`);
        }
        return plan;
    } catch (err) {
        console.error(`❌ [Planner] Échec : ${err.message}`);
        // Fallback : plan conversationnel
        return {
            reasoning: `Erreur de planification : ${err.message}`,
            tasks: [{ id: 1, tool: 'respond', args: { message, error: err.message }, depends_on: [] }],
            error: err.message,
        };
    }
}

/**
 * Valide et normalise un plan.
 */
function validatePlan(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Plan invalide (non-objet)');

    let tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    if (tasks.length === 0) {
        throw new Error('Plan vide');
    }

    const validTools = new Set([...getToolNames(), 'respond', 'ask_user']);

    tasks = tasks
        .filter(t => t && typeof t === 'object' && t.tool)
        .map((t, idx) => ({
            id: parseInt(t.id) || idx + 1,
            tool: String(t.tool),
            args: t.args && typeof t.args === 'object' ? t.args : {},
            depends_on: Array.isArray(t.depends_on) ? t.depends_on.map(Number) : [],
            critical: t.critical === true,
        }))
        .filter(t => {
            if (!validTools.has(t.tool)) {
                console.warn(`⚠️  [Planner] Outil inconnu ignoré : ${t.tool}`);
                return false;
            }
            return true;
        });

    // Limiter à 8 tâches
    if (tasks.length > 8) {
        console.warn(`⚠️  [Planner] Plan trop long (${tasks.length}), tronqué à 8`);
        tasks = tasks.slice(0, 8);
    }

    // Dans validatePlan(), après le filter principal
    tasks = removeRedundantAskUser(tasks);

    function removeRedundantAskUser(tasks) {
        // Si la tâche suivante n'utilise AUCUN placeholder de ask_user,
        // le ask_user est inutile
        return tasks.filter(task => {
            if (task.tool !== 'ask_user') return true;
            
            // Vérifie si une tâche dépend de celle-ci
            const dependents = tasks.filter(t => 
                t.depends_on && t.depends_on.includes(task.id)
            );
            
            // Si aucun dépendant n'utilise de placeholder, on supprime
            const usesPlaceholder = dependents.some(t =>
                JSON.stringify(t.args).includes(`{{task_${task.id}.`)
            );
            
            if (!usesPlaceholder) {
                console.log(`🧹 [Planner] ask_user ${task.id} supprimé (aucun placeholder utilisé)`);
                return false;
            }
            return true;
        });
    }
    
    return {
        reasoning: String(raw.reasoning || '').slice(0, 500),
        tasks,
    };
}

module.exports = { plan };