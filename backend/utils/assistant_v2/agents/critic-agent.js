// backend/utils/assistant/agents/critic-agent.js
// Agent 4 : Vérification de cohérence avant exécution d'une action critique.
// Retourne { ok: boolean, issues: [], suggestions: [] }

const llm = require('../llm/client');
const prompts = require('../llm/prompts');

/**
 * Vérifie une action avant exécution.
 * @param {Object} action - { tool, args }
 * @param {Object} context - Contexte (session, userPrefs, données actuelles)
 * @returns {Promise<{ok, issues, suggestions}>}
 */
async function check(action, context = {}) {
    if (!action || !action.tool) {
        return { ok: false, issues: ['Action invalide'], suggestions: [] };
    }

    // 1. Vérifications mécaniques (rapides, sans LLM)
    const mechanical = mechanicalChecks(action, context);
    if (!mechanical.ok) {
        console.log(`🛑 [Critic] Échec mécanique : ${mechanical.issues.join(', ')}`);
        return mechanical;
    }

    // 2. Vérification LLM uniquement pour les cas complexes
    const needsLlm = ['create_quote', 'update_quote', 'create_product', 'create_service', 'adjust_stock'];
    if (!needsLlm.includes(action.tool)) {
        return { ok: true, issues: [], suggestions: [] };
    }

    try {
        const result = await llm.chatJSON({
            system: prompts.CRITIC_SYSTEM,
            user: prompts.buildCriticUser({
                action,
                context,
                data: context.data || {},
            }),
            tier: 'light',
            temperature: 0,
            maxTokens: 300,
        });

        const ok = result.ok === true;
        const issues = Array.isArray(result.issues) ? result.issues : [];
        const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];

        if (!ok) {
            console.log(`🛑 [Critic] LLM → refusé : ${issues.join(', ')}`);
        } else {
            console.log(`✅ [Critic] LLM → validé`);
        }

        return { ok, issues, suggestions };
    } catch (err) {
        // En cas d'échec du LLM, on laisse passer (fail-open) mais on log
        console.warn(`⚠️  [Critic] Échec LLM, fail-open : ${err.message}`);
        return { ok: true, issues: [], suggestions: [] };
    }
}

/**
 * Vérifications mécaniques rapides.
 */
function mechanicalChecks(action, context) {
    const { tool, args } = action;
    const issues = [];

    // Champs obligatoires vides
    for (const [key, val] of Object.entries(args || {})) {
        if (val === null || val === undefined || val === '') {
            // Ce n'est pas forcément un problème si le champ est optionnel
        }
    }

    // Cas spécifiques
    if (tool === 'send_quote_email' || tool === 'send_invoice_email') {
        const email = args.email;
        if (!email || !/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
            issues.push(`Email invalide : "${email}"`);
        }
    }

    if (tool === 'create_quote') {
        if (!args.items || !Array.isArray(args.items) || args.items.length === 0) {
            issues.push('Aucun article pour créer le devis');
        } else {
            const zeroPriceItems = args.items.filter(i => !i.unitPrice || i.unitPrice <= 0);
            if (zeroPriceItems.length > 0) {
                issues.push(`${zeroPriceItems.length} article(s) sans prix`);
            }
        }
    }

    if (tool === 'mark_invoice_paid') {
        if (!args.invoiceId && !args.invoiceNumber) {
            issues.push('Aucune facture ciblée');
        }
    }

    if (tool === 'delete_quote') {
        if (!args.quoteId && !args.quoteRef) {
            issues.push('Aucun devis ciblé pour suppression');
        }
    }

    if (issues.length > 0) {
        return { ok: false, issues, suggestions: [] };
    }
    return { ok: true, issues: [], suggestions: [] };
}

module.exports = { check };