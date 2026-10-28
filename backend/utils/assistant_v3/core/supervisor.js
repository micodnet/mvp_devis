// agents/core/supervisor.js
const { prisma } = require('../services/prisma');
const { SupervisorAgent } = require('../agents/supervisorAgent');

/**
 * Lance un cycle de supervision pour UN tenant.
 * Idempotent dans le temps : chaque passage a son propre sessionId.
 */
async function runSupervisorCycleForTenant(tenantId) {
  const sessionId = `cron::${tenantId}::${Date.now()}`;
  const agent = new SupervisorAgent();

  const ctx = {
    tenantId,
    userId: "system",
    role: "ADMIN", // le superviseur voit tout
    sessionId,
    agentName: agent.name,
  };

  const startedAt = Date.now();
  console.log(`[supervisor] start tenant=${tenantId}`);

  const result = await agent.run(
    "Fais un état des lieux et propose les actions utiles (relances impayés, devis à relancer, chantiers en dérive).",
    ctx
  );

  const elapsed = Date.now() - startedAt;
  console.log(
    `[supervisor] tenant=${tenantId} ok=${result.ok} elapsed=${elapsed}ms steps=${result.steps || 0}`
  );

  // Trace persistée
  await prisma.agentTrace.create({
    data: {
      tenantId,
      userId: "system",
      agent: "SupervisorAgent",
      goal: "cron-cycle",
      steps: result.trace || [],
      result: result.answer || result.reason || null,
    },
  });

  return result;
}

// Boucle sur tous les tenants.
export async function runSupervisorCycleAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  const results = [];
  for (const t of tenants) {
    try {
      const r = await runSupervisorCycleForTenant(t.id);
      results.push({ tenantId: t.id, tenantName: t.name, ok: r.ok });
    } catch (e) {
      console.error(`[supervisor] tenant=${t.id} failed:`, e.message);
      results.push({ tenantId: t.id, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { runSupervisorCycleForTenant, runSupervisorCycleAllTenants };