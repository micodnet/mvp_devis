// agents/core/agent.js
// import OpenAI from "openai";
const { chat, consumeTokens } = require('./llm');
const { getToolsForAgent, toOpenAISchema } = require('./toolRegistry');
const { Memory } = require('./memory');
const { buildSummary } = require('./confirmation');
const { pendingActionService } = require('./pendingActionService');
const { longTermMemory } = require('./longTermMemory');

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class Agent {
  //   /**
//    * @param {Object} cfg
//    * @param {string} cfg.name
//    * @param {string} cfg.systemPrompt
//    * @param {string[]} cfg.tools          - noms de tools autorisés
//    * @param {number} cfg.maxSteps          - garde-fou anti-boucle infinie
//    * @param {object} cfg.permissions       - { read:[], write:[] }
//    * @param {object} cfg.context           - userId, tenantId, etc.
//    */

  constructor(cfg) {
    this.name = cfg.name;
    this.systemPrompt = cfg.systemPrompt;
    this.toolNames = cfg.tools;
    this.maxSteps = cfg.maxSteps ?? 10;
//     this.permissions = cfg.permissions;
//     this.context = cfg.context;
    this.memory = new Memory(cfg.name);
  }

  buildSystemPrompt(ctx, recalled = []) {
    const memBlock = recalled.length
    ? recalled.map((m) => `- [${m.kind}, ${m.similarity.toFixed(2)}] ${m.text}`).join("\n")
    : "(aucun souvenir pertinent)";

    return `${this.systemPrompt}

    CONTEXTE SÉCURISÉ (injecté par le serveur, ne jamais modifier) :
    - userId : ${ctx.userId}
    - tenantId : ${ctx.tenantId}
    - rôle : ${ctx.role}
    - sessionId : ${ctx.sessionId}

    SOUVENIRS LONG TERME PERTINENTS (récupérés par similarité sémantique) :
    ${memBlock}

    SOUVENIRS RÉCENTS :
    ${this.memory.longTermSummary() || "(aucun)"}

    RÈGLES STRICTES :
    1. Tu ne devines JAMAIS un ID. Tu le récupères via un tool de recherche.
    2. Avant toute ÉCRITURE, tu vérifies l'état via un tool de lecture.
    3. Certaines actions sont sensibles : quand un tool renvoie { pending: true, summary }, cela signifie
      que l'action est MISE EN ATTENTE de confirmation utilisateur. Dans ce cas :
      - tu NE rappelles PAS ce tool,
      - tu NE tentes PAS de contourner,
      - tu formules une courte question à l'utilisateur en reprenant le résumé fourni.
    4. Utilise "recall" quand une info passée pourrait aider. Utilise "remember" pour mémoriser
      une préférence, une règle client, ou une leçon utile.
    5. Si une information manque, tu poses UNE question claire et tu t'arrêtes.
    6. Tu réponds en français, de façon concise et professionnelle.
    7. Tu ne dépasses jamais les outils autorisés.`;
  }

  async run(goal, ctx, { onStep } = {}) {
    const tools = getToolsForAgent({ toolNames: this.toolNames, role: ctx.role });// , this.permissions
    const schemas = tools.map(toOpenAISchema);
    const toolsByName = new Map(tools.map((t) => [t.name, t]));

    // 1. Charge les souvenirs longs pertinents AVANT de démarrer
    let recalled = [];

    try {
      recalled = await longTermMemory.recall({
        tenantId: ctx.tenantId,
        agent: this.name,
        query: goal,
        k: 5,
      });
    } catch (e) {
      console.warn("[memory] recall failed:", e.message);
    }

    // Expose le nom de l'agent aux tools (pour la mémoire scopée)
    const ctxWithAgent = { ...ctx, agentName: this.name };


    const messages = [
      { role: "system", content: this.buildSystemPrompt(ctxWithAgent, recalled) },
      ...this.memory.shortTerm(),
      { role: "user", content: goal },
    ];

    const trace = [];
    let pendingActionId = null;

    for (let step = 0; step < this.maxSteps; step++) {
      const { message, tokens } = await chat({
        messages,
        tools: schemas,
        tool_choice: "auto",
      });
      //     for (let step = 0; step < this.maxSteps; step++) {
      //       const res = await openai.chat.completions.create({
      //         model: "gpt-4o",
      //         messages,
      //         tools: toolSchemas,
      //         tool_choice: "auto",
      //         temperature: 0.2,
      //       });

      //       const msg = res.choices[0].message;
      //       messages.push(msg);

      if (!consumeTokens(ctx.sessionId, tokens)) {
        return { ok: false, agent: this.name, reason: "budget_exceeded", trace, pendingActionId };
      }

      messages.push(message);

      // Réponse finale du LLM
      if (!message.tool_calls?.length) {
        this.memory.add({ goal, result: message.content, trace });

        // 2. Persiste un résumé compact en mémoire longue
        try {
          const summary = `Objectif : ${goal.slice(0, 200)}\nRésultat : ${String(message.content).slice(0, 300)}`;
          await longTermMemory.remember({
            tenantId: ctx.tenantId,
            agent: this.name,
            kind: "observation",
            text: summary,
            metadata: { tools: trace.map((t) => t.tool) },
          });
        } catch (e) {
          console.warn("[memory] remember failed:", e.message);
        }

        return {
          ok: true,
          agent: this.name,
          answer: message.content,
          pendingActionId,
          trace,
          steps: step + 1,
        };
      }

      // Exécution des tool calls
      for (const call of message.tool_calls) {
        const def = toolsByName.get(call.function.name);
        //const tool = tools.find(t => t.schema.function.name === call.function.name);
        let observation;

        if (!def) {
          observation = { ok: false, error: `Tool non autorisé : ${call.function.name}` };
        } else {
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            // injection du contexte (userId, tenant) — JAMAIS laissé au LLM
  //             const result = await tool.handler(args, this.context);
  //             observation = { ok: true, data: result };
            if (def.requiresConfirmation) {
              const summary = await buildSummary(def, args, ctx);
              const pending = await pendingActionService.create({
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                sessionId: ctx.sessionId,
                toolName: def.name,
                args,
                summary,
              });

              pendingActionId = pending.id;
              observation = {
                pending: true,
                pendingActionId: pending.id,
                summary: pending.summary,
                message:
                  "Action mise en attente de confirmation utilisateur. Ne rappelle PAS ce tool. Formule une question courte en reprenant le résumé.",
              };
            } else {
              const data = await def.handler(args, ctx);
              observation = { ok: true, data };
            }
          } catch (err) {
            observation = { ok: false, error: err.message };
          }
        }

        const traceEntry = {
          step,
          tool: call.function.name,
          args: call.function.arguments,
          observation,
          at: new Date().toISOString(),
        };
        trace.push(traceEntry);
        onStep?.(traceEntry);
        //         onStep?.(trace.at(-1));

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(observation),
        });
      }
    }

    return {
      ok: false,
      agent: this.name,
      reason: "max_steps_reached",
      trace,
      pendingActionId,
    };
  }
}

module.exports = { Agent };