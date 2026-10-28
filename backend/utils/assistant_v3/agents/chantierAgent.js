// agents/agents/chantierAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class ChantierAgent extends Agent {
  constructor() {
    super({
      name: "ChantierAgent",
      systemPrompt: PROMPTS.chantier,
      tools: [
        "search_client",
        "search_chantiers",
        "create_chantier",
        "update_chantier_status",
      ],
      maxSteps: 10,
    });
  }
}

module.exports = { ChantierAgent };