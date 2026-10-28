// agents/tools/memoryTools.js
const { registerTool } = require('../core/toolRegistry');
const { longTermMemory } = require('../core/longTermMemory');

registerTool({
  name: "remember",
  description:
    "Enregistre un fait durable en mémoire long terme (préférences client, contexte récurrent, leçon apprise).",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["observation", "preference", "lesson", "context"],
      },
      text: { type: "string", description: "Phrase courte et informative." },
      metadata: { type: "object", description: "Données structurées optionnelles." },
    },
    required: ["kind", "text"],
  },
  scope: "memory",
  write: true,
  handler: async (args, ctx) => {
    const r = await longTermMemory.remember({
      tenantId: ctx.tenantId,
      agent: ctx.agentName || "shared",
      kind: args.kind,
      text: args.text,
      metadata: args.metadata,
    });
    return { remembered: true, id: r.id };
  },
});

registerTool({
  name: "recall",
  description:
    "Recherche en mémoire long terme des informations pertinentes pour la question actuelle.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      k: { type: "number", description: "Nombre de souvenirs (défaut 5)" },
    },
    required: ["query"],
  },
  scope: "memory",
  write: false,
  handler: async (args, ctx) => {
    return longTermMemory.recall({
      tenantId: ctx.tenantId,
      agent: ctx.agentName || "shared",
      query: args.query,
      k: args.k ?? 5,
    });
  },
});