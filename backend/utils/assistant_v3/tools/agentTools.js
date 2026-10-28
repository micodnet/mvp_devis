// agents/tools/agentTools.js
const { registerTool } = require('../core/toolRegistry');
const { getAgent, listAgents } = require('../core/agentRegistry');

/**
 * Ce tool permet à un agent d'interroger un AUTRE agent.
 * Ex : DevisAgent peut demander à FactureAgent si une facture existe déjà.
 *
 * Anti-récursion : un agent ne peut pas s'appeler lui-même.
 * Profondeur limitée par ctx.__agentDepth (max 2 niveaux).
 */
registerTool({
  name: "ask_agent",
  description:
    "Pose une question à un autre agent spécialisé. Utile pour vérifier une info cross-domaine. " +
    "Agents disponibles : DevisAgent, FactureAgent, MailAgent, StatsAgent, ChantierAgent, ClientAgent.",
  parameters: {
    type: "object",
    properties: {
      agentName: {
        type: "string",
        enum: ["DevisAgent", "FactureAgent", "MailAgent", "StatsAgent", "ChantierAgent", "ClientAgent"],
      },
      question: { type: "string" },
    },
    required: ["agentName", "question"],
  },
  scope: "memory", // volontairement permissif : utilisé par tous les agents
  write: false,
  handler: async (args, ctx) => {
    // 🛡 Anti-récursion : pas d'auto-appel, profondeur max 2
    if (args.agentName === ctx.agentName) {
      return { ok: false, error: "Un agent ne peut pas s'appeler lui-même." };
    }
    const depth = ctx.__agentDepth || 0;
    if (depth >= 2) {
      return { ok: false, error: "Profondeur d'appels inter-agents dépassée (max 2)." };
    }

    const child = getAgent(args.agentName);
    if (!child) return { ok: false, error: `Agent inconnu : ${args.agentName}` };

    // On transmet le même contexte utilisateur, mais on trace la filiation.
    const subCtx = {
      ...ctx,
      agentName: args.agentName,
      __agentDepth: depth + 1,
      sessionId: `${ctx.sessionId}::sub::${args.agentName}`,
    };

    const res = await child.run(args.question, subCtx);

    return {
      ok: res.ok,
      agent: args.agentName,
      answer: res.answer || res.reason,
      // On ne remonte PAS la trace complète pour ne pas polluer
      steps: (res.trace || []).map((t) => t.tool),
    };
  },
});

registerTool({
  name: "list_agents",
  description: "Liste les agents disponibles pour la communication inter-agents.",
  parameters: { type: "object", properties: {} },
  scope: "memory",
  write: false,
  handler: async () => ({ agents: listAgents() }),
});