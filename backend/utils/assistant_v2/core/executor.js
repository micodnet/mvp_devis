// backend/utils/assistant/core/executor.js
// Exécute un plan tâche par tâche.
// - Résout les dépendances ({{task_1.id}})
// - Appelle le Critic pour les actions critiques
// - S'arrête sur les pendingAction (confirmation utilisateur)

const { getTool, runTool } = require('../tools/registry');
const criticAgent = require('../agents/critic-agent');
const calculatorAgent = require('../agents/calculator-agent');

/**
 * Exécute un plan.
 * @param {Object} plan - { tasks: [...] }
 * @param {number} userId
 * @param {Object} context - { session, userPrefs, ... }
 * @returns {Promise<{results, pendingAction, errors}>}
 */
async function execute(plan, userId, context) {
    const results = {};       // taskId → résultat
    const errors = [];        // liste d'erreurs non-bloquantes
    let pendingAction = null; // si une action nécessite confirmation

    for (const task of plan.tasks) {
        // 1. Vérifier les dépendances
        if (!dependenciesSatisfied(task, results)) {
            console.warn(`⏭️  [Executor] Tâche ${task.id} sautée (dépendances non satisfaites)`);
            continue;
        }

        // 2. Résoudre les placeholders {{task_1.id}}
        const resolvedArgs = resolveArgs(task.args, results);

        // 3. Cas spéciaux
        if (task.tool === 'respond') {
            results[task.id] = { type: 'respond', result: resolvedArgs };
            continue;
        }
        if (task.tool === 'ask_user') {
            results[task.id] = { type: 'ask_user', result: resolvedArgs };
            pendingAction = {
                kind: 'ask_user',
                question: resolvedArgs.question || 'Pouvez-vous préciser ?',
                taskId: task.id,
            };
            break;
        }

        // 4. Exécuter l'outil
        const toolDef = getTool(task.tool);
        if (!toolDef) {
            errors.push({ taskId: task.id, error: `Outil inconnu : ${task.tool}` });
            continue;
        }

        try {
            const startedAt = Date.now();

            // 4a. Pour les actions critiques, on appelle le Critic AVANT
            if (toolDef.critical) {
                const verdict = await criticAgent.check(
                    { tool: task.tool, args: resolvedArgs },
                    { ...context, data: resolvedArgs }
                );
                if (!verdict.ok) {
                    console.log(`🛑 [Executor] Critic refuse la tâche ${task.id} : ${verdict.issues.join(', ')}`);
                    errors.push({
                        taskId: task.id,
                        error: 'Critic refuse : ' + verdict.issues.join(', '),
                        issues: verdict.issues,
                    });
                    continue;
                }
            }

            // 4b. Exécution
            const rawResult = await runTool(task.tool, resolvedArgs, userId, context);
            const durationMs = Date.now() - startedAt;

            console.log(`⚙️  [Executor] Tâche ${task.id} (${task.tool}) → ${durationMs}ms`);

            // 4c. Si c'est un brouillon (prepare), on arrête et on demande confirmation
            if (isDraft(rawResult)) {
                console.log(`📝 [Executor] Tâche ${task.id} → brouillon en attente`);
                pendingAction = {
                    kind: 'confirm_action',
                    taskId: task.id,
                    draft: rawResult,
                    tool: task.tool,
                    args: resolvedArgs,
                };
                results[task.id] = { result: rawResult, pending: true };
                break; // On arrête l'exécution, on attend la confirmation
            }

            results[task.id] = { result: rawResult, durationMs };
        } catch (err) {
            console.error(`❌ [Executor] Tâche ${task.id} échouée : ${err.message}`);
            errors.push({ taskId: task.id, error: err.message });
        }
    }

    return { results, pendingAction, errors };
}

/**
 * Vérifie que toutes les dépendances sont satisfaites.
 */
function dependenciesSatisfied(task, results) {
    if (!task.depends_on || task.depends_on.length === 0) return true;
    return task.depends_on.every(depId => results[depId] !== undefined);
}

/**
 * Remplace les placeholders {{task_1.id}} par les vraies valeurs.
 */
function resolveArgs(args, results) {
    if (!args || typeof args !== 'object') return args;

    const resolveValue = (val) => {
        if (typeof val === 'string') {
            // {{task_1.id}} ou {{task_1.result.id}}
            return val.replace(/\{\{task_(\d+)\.([\w.]+)\}\}/g, (match, taskId, path) => {
                const taskResult = results[parseInt(taskId)];
                if (!taskResult) return match;
                return getNestedValue(taskResult, path);
            });
        }
        if (Array.isArray(val)) return val.map(resolveValue);
        if (val && typeof val === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(val)) out[k] = resolveValue(v);
            return out;
        }
        return val;
    };

    return resolveValue(args);
}

function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return null;
        current = current[part];
    }
    return current;
}

/**
 * Un résultat est un "brouillon" si c'est un objet avec la forme d'une action pendante.
 */
function isDraft(result) {
    return result
        && typeof result === 'object'
        && result.type
        && result.summary
        && result.preview
        && result.payload;
}

module.exports = { execute, resolveArgs };