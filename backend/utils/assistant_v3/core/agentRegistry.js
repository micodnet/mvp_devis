// agents/core/agentRegistry.js
const agents = new Map();

/**
 * Enregistre un agent dans le registry global.
 * @param {string} name
 * @param {() => Agent} factory  → factory pour éviter les cycles d'import
 */
function registerAgent(name, factory) {
  agents.set(name, factory);
}

function getAgent(name) {
  const factory = agents.get(name);
  if (!factory) return null;
  return factory();
}

function listAgents() {
  return [...agents.keys()];
}

module.exports = { registerAgent, getAgent, listAgents };