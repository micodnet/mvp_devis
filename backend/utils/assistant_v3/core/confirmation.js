// agents/core/confirmation.js
/**
 * Construit un résumé lisible d'une action à confirmer.
 * Si le tool définit summarize(), on l'utilise ; sinon fallback générique.
 * summarize peut être async (ex: faire un lookup DB pour un libellé).
 */
async function buildSummary(toolDef, args, ctx) {
  if (typeof toolDef.summarize === "function") {
    try {
      const s = await toolDef.summarize(args, ctx);
      if (s && typeof s === "string") return s;
    } catch {
      // on tombe sur le fallback
    }
  }
  return `Exécution de l'action "${toolDef.name}"`;
}

module.exports = { buildSummary };