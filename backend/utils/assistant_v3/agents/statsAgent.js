// agents/agents/statsAgent.js
const { Agent } = require('../core/agent');
const { PROMPTS } = require('../config/prompts');

class StatsAgent extends Agent {
  constructor() {
    super({
      name: "StatsAgent",
      systemPrompt: PROMPTS.stats,
      tools: ["stats_overview", "stats_revenue_by_month"],
      maxSteps: 6,
    });
  }
}

module.exports = { StatsAgent };