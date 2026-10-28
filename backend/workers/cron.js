// workers/cron.js
import "dotenv/config";
import "../utils/assistant_v3/agents/tools/index.js"; // enregistre TOUS les tools, sinon le superviseur ne voit rien
import "../utils/assistant_v3/core/orchestrator.js"; // enregistre les agents dans le registry
import { runSupervisorCycleAllTenants } from "../utils/assistant_v3//core/supervisor.js";

/**
 * Intervalle configurable (par défaut : 1h).
 * En prod, préfère un vrai cron système (systemd timer, k8s CronJob, Vercel Cron…)
 * plutôt qu'un setInterval dans le même process que l'API.
 */
const INTERVAL_MS = Number(process.env.SUPERVISOR_INTERVAL_MS || 3600_000);
const RUN_ON_START = process.env.SUPERVISOR_RUN_ON_START === "1";

async function tick() {
  const startedAt = new Date();
  console.log(`\n[cron] tick at ${startedAt.toISOString()}`);
  try {
    const results = await runSupervisorCycleAllTenants();
    console.log(`[cron] done — ${results.length} tenants traités`);
  } catch (e) {
    console.error("[cron] fatal:", e);
  }
}

async function main() {
  if (RUN_ON_START) await tick();
  setInterval(tick, INTERVAL_MS);
  console.log(`[cron] démarré — intervalle ${INTERVAL_MS / 1000}s`);
}

main();