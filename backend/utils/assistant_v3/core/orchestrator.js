// agents/core/orchestrator.js
const { classifyIntent, classifyConfirmation } = require('./llm');
const { getTool } = require('./toolRegistry');
const { pendingActionService } = require('./pendingActionService');
const { registerAgent } = require('./agentRegistry');
const { DevisAgent } = require('../agents/devisAgent');
const { FactureAgent } = require('../agents/factureAgent');
const { MailAgent } = require('../agents/mailAgent');
const { StatsAgent } = require('../agents/statsAgent');
const { ChantierAgent } = require('../agents/chantierAgent');
const { ClientAgent } = require('../agents/clientAgent');
const { SupervisorAgent } = require('../agents/supervisorAgent');

// Enregistrement pour la communication inter-agents
registerAgent("DevisAgent", () => new DevisAgent());
registerAgent("FactureAgent", () => new FactureAgent());
registerAgent("MailAgent", () => new MailAgent());
registerAgent("StatsAgent", () => new StatsAgent());
registerAgent("ChantierAgent", () => new ChantierAgent());
registerAgent("ClientAgent", () => new ClientAgent());
registerAgent("SupervisorAgent", () => new SupervisorAgent());

const agents = {
  devis:      new DevisAgent(),
  facture:    new FactureAgent(),
  mail:       new MailAgent(),
  stats:      new StatsAgent(),
  chantier:   new ChantierAgent(),
  client:     new ClientAgent(),
  supervisor: new SupervisorAgent(),
};

/**
 * Point d'entrée unique.
 * @param {string} message
 * @param {object} ctx    - { userId, tenantId, role, sessionId }
 * @param {object} hooks  - { onStep, onAgent }
 */

// Routeur simple basé sur intentions (ou LLM de routing)
async function orchestrate(message, ctx, hooks = {}) {
  // 1. Y a-t-il une action PENDING active pour cette session ?
  const pending = await pendingActionService.getActiveForSession(ctx.sessionId);

  if (pending) {
    const intent = await classifyConfirmation(message);

    if (intent === "yes") {
      return confirmPending(pending, ctx, hooks);
    }

    if (intent === "no") {
      await pendingActionService.markCancelled(pending.id);
      return {
        ok: true,
        agent: "confirmation",
        answer: "❌ Action annulée.",
        trace: [],
      };
    }

    // intent === "other" → l'utilisateur change de sujet, on annule la pending
    await pendingActionService.markCancelled(pending.id);
  }

  // 2. Routing normal
  // Option A : LLM classifieur
  const route = await classify(message);
  hooks.onAgent?.(route === "multi" ? "multi" : route);

  // Option B : règles
  // const route = /devis/i.test(userMessage) ? "devis" : "stats";

  if (route === "multi") {
    // Exécution séquentielle : devis → facture, etc. (à affiner selon besoin)
    const results = [];
    for (const key of ["devis", "facture", "chantier", "client"]) {
      const r = await agents[key].run(message, ctx, hooks);
      results.push({ agent: key, result: r });
    }
    return {
      ok: true,
      agent: "multi",
      answer: results
        .map(r => `[${r.agent}] ${r.result.answer || r.result.reason}`)
        .join("\n\n"),
      trace: results.flatMap(r => r.result.trace || []),
    };
  }

  const agent = agents[route] || agents.devis;
  if (!agent) return { error: "Aucun agent compétent" };

  // Chaque agent reçoit le même contexte sécurisé
  return agent.run(message, ctx, hooks);
}

async function classify(text) {
  // Appel mini-LLM qui renvoie "devis" | "facture" | "mail" | "stats" | "multi"
  // Pour "multi", tu lances plusieurs agents et tu agrèges.
}

/**
 * Exécute réellement une PendingAction après confirmation.
 */
async function confirmPending(pending, ctx, hooks) {
  const def = getTool(pending.toolName);

  if (!def) {
    await pendingActionService.markFailed(pending.id, "Tool introuvable");
    return {
      ok: false,
      agent: "confirmation",
      answer: ` Le tool "${pending.toolName}" n'existe plus. Action annulée.`,
      trace: [],
    };
  }

  try {
    const data = await def.handler(pending.args, ctx);
    await pendingActionService.markConfirmed(pending.id);

    const step = {
      tool: pending.toolName,
      args: JSON.stringify(pending.args),
      observation: { ok: true, data },
      at: new Date().toISOString(),
    };
    hooks.onStep?.(step);

    return {
      ok: true,
      agent: "confirmation",
      answer: ` ${pending.summary} — effectué avec succès.`,
      result: data,
      trace: [step],
    };
  } catch (e) {
    await pendingActionService.markFailed(pending.id, e.message);
    return {
      ok: false,
      agent: "confirmation",
      answer: ` Échec de l'action : ${e.message}`,
      trace: [],
    };
  }
}

module.exports = { orchestrate, classify, confirmPending };