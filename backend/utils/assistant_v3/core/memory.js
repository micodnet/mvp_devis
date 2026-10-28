// agents/core/memory.js
/**
 * Mémoire d'agent :
 * - shortTerm : fenêtre glissante des derniers échanges (par agent)
 * - longTerm  : souvenirs clés (résumés d'actions passées)
 *
 * En prod : remplacer par Redis + pgvector pour RAG réel.
 */
const stores = new Map();

class Memory {
  constructor(agentName, { maxShort = 10, maxLong = 50 } = {}) {
    this.agentName = agentName;
    this.maxShort = maxShort;
    this.maxLong = maxLong;
    if (!stores.has(agentName)) {
      stores.set(agentName, { short: [], long: [] });
    }
    this.store = stores.get(agentName);
  }

  add({ goal, result, trace }) {
    // Court terme
    this.store.short.push({ goal, result, at: Date.now() });
    if (this.store.short.length > this.maxShort) this.store.short.shift();

    // Long terme : résumé compact
    this.store.long.push({
      goal,
      tools: (trace || []).map(t => t.tool),
      ok: true,
      at: Date.now(),
    });
    if (this.store.long.length > this.maxLong) this.store.long.shift();
  }

  shortTerm() {
    // On réinjecte sous forme de messages système légers
    return this.store.short.slice(-3).map(m => ({
      role: "system",
      content: `[Souvenir] Objectif précédent : "${m.goal}" → ${String(m.result).slice(0, 200)}`,
    }));
  }

  longTermSummary() {
    return this.store.long.slice(-5).map(l => `- ${l.goal} (tools: ${l.tools.join(",")})`).join("\n");
  }

  clear() {
    this.store.short = [];
    this.store.long = [];
  }
}

module.exports = { Memory };