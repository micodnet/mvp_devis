// agents/agents/devisAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class DevisAgent extends Agent {
  constructor() {
    super({
      name: "DevisAgent",
      systemPrompt: PROMPTS.devis + `\n\nTu peux interroger un autre agent (FactureAgent, ChantierAgent, ClientAgent)
        via "ask_agent" pour récupérer une info cross-domaine avant d'agir.`,
      tools: [
        "search_client",
        "search_devis",
        "get_devis",
        "create_devis",
        "update_devis",
        "update_devis_status",
        "ask_agent",      
        "remember",       
        "recall",
        // send_devis_by_email est présent mais filtré par permissions (scope "mail")
      ],
      permissions: {
        read:  ["devis","client"],
        write: ["devis"],  // pas "mail" ici : il délègue au MailAgent
      },
      maxSteps: 12,
    });
  }
}
// Déclarer ask_agent dans les agents qui en ont besoin

module.exports = { DevisAgent };