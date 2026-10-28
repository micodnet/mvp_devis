// agents/agents/factureAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class FactureAgent extends Agent {
  constructor() {
    super({
      name: "FactureAgent",
      systemPrompt: PROMPTS.facture,
      tools: [
        "search_client",
        "search_devis",
        "search_factures",
        "create_facture_from_devis",
        "mark_facture_paid",
      ],
      maxSteps: 10,
    });
  }
}

module.exports = { FactureAgent };