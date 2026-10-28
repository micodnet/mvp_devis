// agents/agents/clientAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class ClientAgent extends Agent {
  constructor() {
    super({
      name: "ClientAgent",
      systemPrompt: PROMPTS.client,
      tools: ["search_client", "create_client", "update_client"],
      maxSteps: 8,
    });
  }
}

module.exports = { ClientAgent };