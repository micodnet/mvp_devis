// agents/tools/statsTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');

registerTool({
  name: "stats_overview",
  description: "Vue d'ensemble : nombre de devis, taux d'acceptation, CA facturé, impayés.",
  parameters: { type: "object", properties: {} },
  scope: "stats",
  write: false,
  handler: async (_args, ctx) => {
    const [devisCount, devisAccepted, devisRefused, factures, impayees] = await Promise.all([
      prisma.devis.count({ where: { tenantId: ctx.tenantId } }),
      prisma.devis.count({ where: { tenantId: ctx.tenantId, status: "ACCEPTE" } }),
      prisma.devis.count({ where: { tenantId: ctx.tenantId, status: "REFUSE" } }),
      prisma.facture.findMany({ where: { tenantId: ctx.tenantId, status: "PAYEE" } }),
      prisma.facture.findMany({ where: { tenantId: ctx.tenantId, status: "IMPAYEE" } }),
    ]);

    const ca = factures.reduce((s, f) => s + f.totalTTC, 0);
    const impaye = impayees.reduce((s, f) => s + f.totalTTC, 0);
    const taux = devisCount ? ((devisAccepted / devisCount) * 100).toFixed(1) : "0";

    return {
      devisTotal: devisCount,
      devisAcceptes: devisAccepted,
      devisRefuses: devisRefused,
      tauxAcceptation: `${taux}%`,
      chiffreAffairesTTC: ca,
      impayesTTC: impaye,
    };
  },
});

registerTool({
  name: "stats_revenue_by_month",
  description: "Chiffre d'affaires TTC par mois sur les N derniers mois.",
  parameters: {
    type: "object",
    properties: { months: { type: "number", description: "Défaut 12" } },
  },
  scope: "stats",
  write: false,
  handler: async (args, ctx) => {
    const months = args.months ?? 12;
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const factures = await prisma.facture.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "PAYEE",
        paidAt: { gte: since },
      },
      select: { totalTTC: true, paidAt: true },
    });

    const buckets = {};
    for (const f of factures) {
      const k = `${f.paidAt.getFullYear()}-${String(f.paidAt.getMonth() + 1).padStart(2, "0")}`;
      buckets[k] = (buckets[k] || 0) + f.totalTTC;
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
  },
});