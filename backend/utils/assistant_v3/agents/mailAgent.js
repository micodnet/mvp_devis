// agents/agents/mailAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class MailAgent extends Agent {
  constructor() {
    super({
      name: "MailAgent",
      systemPrompt: PROMPTS.mail,
      tools: [
        "search_client",
        "search_devis",
        "get_devis",
        "send_email",
        "send_devis_by_email",
      ],
      maxSteps: 8,
    });
  }
}

module.exports = { MailAgent };