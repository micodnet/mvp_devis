// // agents/core/llm.js
// import OpenAI from "openai";

// export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Budget tokens global par session (in-memory; en prod → Redis)
// const budgets = new Map();

// export function consumeTokens(sessionId, tokens) {
//   if (!sessionId) return true;
//   const used = (budgets.get(sessionId) || 0) + tokens;
//   budgets.set(sessionId, used);
//   const max = Number(process.env.MAX_TOKENS_PER_SESSION || 60000);
//   return used <= max;
// }

// export async function chat({ messages, tools, tool_choice = "auto", model = "gpt-4o", temperature = 0.2 }) {
//   const res = await openai.chat.completions.create({
//     model,
//     messages,
//     tools,
//     tool_choice,
//     temperature,
//   });
//   const tokens = res.usage?.total_tokens || 0;
//   return { message: res.choices[0].message, tokens };
// }

// export async function classifyIntent(text) {
//   const res = await openai.chat.completions.create({
//     model: "gpt-4o-mini",
//     temperature: 0,
//     messages: [
//       {
//         role: "system",
//         content: `Tu classifies une demande utilisateur en UNE catégorie parmi :
// - devis
// - facture
// - mail
// - stats
// - chantier
// - client
// - multi (si plusieurs domaines)
// Réponds uniquement par le mot-clé.`,
//       },
//       { role: "user", content: text },
//     ],
//   });
//   const out = res.choices[0].message.content.trim().toLowerCase();
//   const allowed = ["devis","facture","mail","stats","chantier","client","multi"];
//   return allowed.includes(out) ? out : "devis";
// }

// agents/core/llm.js
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Budget tokens in-memory par session (à déplacer dans Redis en prod)
const budgets = new Map();

function consumeTokens(sessionId, tokens) {
  if (!sessionId) return true;
  const used = (budgets.get(sessionId) || 0) + tokens;
  budgets.set(sessionId, used);
  const max = Number(process.env.MAX_TOKENS_PER_SESSION || 60000);
  return used <= max;
}

async function chat({
  messages,
  tools,
  tool_choice = "auto",
  model = "gpt-4o",
  temperature = 0.2,
}) {
  const res = await openai.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice,
    temperature,
  });
  const tokens = res.usage?.total_tokens || 0;
  return { message: res.choices[0].message, tokens };
}

/**
 * Routeur d'intention principal.
 * Retourne : "devis" | "facture" | "mail" | "stats" | "chantier" | "client" | "multi"
 */
async function classifyIntent(text) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Tu classifies une demande utilisateur en UNE catégorie parmi :
- devis
- facture
- mail
- stats
- chantier
- client
- multi (si plusieurs domaines)
Réponds uniquement par le mot-clé, en minuscules, sans ponctuation.`,
      },
      { role: "user", content: text },
    ],
  });
  const out = (res.choices[0].message.content || "").trim().toLowerCase();
  const allowed = ["devis", "facture", "mail", "stats", "chantier", "client", "multi"];
  return allowed.includes(out) ? out : "devis";
}

/**
 * Classifieur de confirmation.
 * Retourne : "yes" | "no" | "other"
 */
async function classifyConfirmation(text) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Tu analyses la réponse d'un utilisateur à une demande de confirmation d'action.
          Réponds UNIQUEMENT par un mot, en minuscules, sans ponctuation :
          - "yes" : l'utilisateur confirme (oui, ok, vas-y, confirme, envoie, parfait, d'accord, go, valide...)
          - "no"  : l'utilisateur refuse (non, annule, stop, laisse tomber, pas maintenant, surtout pas...)
          - "other" : tout le reste (question, modification, autre demande, ambiguïté...)`,
      },
      { role: "user", content: text },
    ],
  });
  const out = (res.choices[0].message.content || "").trim().toLowerCase();
  return ["yes", "no", "other"].includes(out) ? out : "other";
}

module.exports = { openai, consumeTokens, chat, classifyIntent, classifyConfirmation };