// // agents/core/toolRegistry.js
// import { can } from "./permissions.js";
// import "../tools/memoryTools.js";

// const registry = new Map();

// /**
//  * Enregistre un tool.
//  * def = {
//  *   name, description, parameters,
//  *   scope: "devis" | "facture" | "mail" | "stats" | "chantier" | "client",
//  *   write: boolean,
//  *   handler: async (args, ctx) => any
//  * }
//  */
// export function registerTool(def) {
//   if (!def.name || !def.handler || !def.scope) {
//     throw new Error(`Tool invalide : ${def.name || "sans nom"}`);
//   }
//   // def = { name, description, parameters, handler, scopes:[], permissions:{read,write} }
//   registry.set(def.name, {
//     schema: {
//       type: "function",
//       function: {
//         name: def.name,
//         description: def.description,
//         parameters: def.parameters,
//       },
//     },
//     handler: def.handler,
//     scopes: def.scopes,       // ex: ["devis","facture"]
//     write: def.write ?? false,
//   });
// }

// export function getAllToolNames() {
//   return [...registry.keys()];
// }

// export function getTool(name) {
//   return registry.get(name);
// }

// /**
//  * Renvoie les tools autorisés pour un agent, filtrés par rôle + liste blanche.
//  */
// // export function getToolsForAgent({ toolNames, role }) {
// //   const out = [];
// //   for (const name of toolNames) {
// //     const def = registry.get(name);
// //     if (!def) continue;
// //     if (!can(role, def.scope, def.write)) continue;
// //     out.push(def);
// //   }
// //   return out;
// // }
// export function getToolsForAgent(names, permissions) {
//   return names
//     .map(n => registry.get(n))
//     .filter(Boolean)
//     .filter(t => {
//       if (t.write && !permissions.write.includes(t.scopes[0])) return false;
//       if (!t.write && !permissions.read.includes(t.scopes[0])) return false;
//       return true;
//     })
//     .map(t => ({ schema: t.schema, handler: t.handler }));
// }

// export function toOpenAISchema(def) {
//   return {
//     type: "function",
//     function: {
//       name: def.name,
//       description: def.description,
//       parameters: def.parameters,
//     },
//   };
// }

// agents/core/toolRegistry.js
const registry = new Map();

/**
 * Enregistre un tool.
 * def = {
 *   name, description, parameters,
 *   scope: "quotes" | "invoices" | "mail" | "stats" | "chantiers" | "clients",
 *   write: boolean,
 *   requiresConfirmation?: boolean,
 *   summarize?: async (args, ctx) => string,
 *   handler: async (args, ctx) => any
 * }
 */
function registerTool(def) {
  if (!def.name || !def.handler || !def.scope) {
    throw new Error(`Tool invalide : ${def.name || "sans nom"}`);
  }
  registry.set(def.name, {
    name: def.name,
    description: def.description || "",
    parameters: def.parameters || { type: "object", properties: {} },
    scope: def.scope,
    write: def.write ?? false,
    requiresConfirmation: def.requiresConfirmation ?? false,
    summarize: def.summarize,
    handler: def.handler,
  });
}

function getAllToolNames() {
  return [...registry.keys()];
}

function getTool(name) {
  return registry.get(name);
}

/**
 * Renvoie les tools autorisés pour un agent.
 * @param {string[]} toolNames  - liste blanche
 * @param {object} permissions  - { read: string[], write: string[] }
 * @returns {Array<{schema, handler}>}
 */
function getToolsForAgent(toolNames, permissions) {
  return toolNames
    .map((n) => registry.get(n))
    .filter(Boolean)
    .filter((t) => {
      if (t.write) return permissions.write.includes(t.scope);
      return permissions.read.includes(t.scope);
    })
    .map((t) => ({
      schema: toOpenAISchema(t),
      handler: t.handler,
      requiresConfirmation: t.requiresConfirmation,
      summarize: t.summarize,
      name: t.name,
    }));
}

function toOpenAISchema(def) {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

module.exports = { registerTool, getAllToolNames, getTool, getToolsForAgent, toOpenAISchema };