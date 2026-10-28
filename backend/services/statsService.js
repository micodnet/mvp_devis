// express/services/statsService.js
const { prisma } = require('../services/prisma');

const statsService = {
  async overview({ tenantId }) {
    const [devisTotal, devisAccepted, devisRefused, facturesPayees, facturesImpayees, chantiersEnCours] =
      await Promise.all([
        prisma.devis.count({ where: { tenantId } }),
        prisma.devis.count({ where: { tenantId, status: "ACCEPTE" } }),
        prisma.devis.count({ where: { tenantId, status: "REFUSE" } }),
        prisma.facture.findMany({ where: { tenantId, status: "PAYEE" }, select: { totalTTC: true } }),
        prisma.facture.findMany({ where: { tenantId, status: "IMPAYEE" }, select: { totalTTC: true } }),
        prisma.chantier.count({ where: { tenantId, status: "EN_COURS" } }),
      ]);

    const ca = facturesPayees.reduce((s, f) => s + f.totalTTC, 0);
    const impaye = facturesImpayees.reduce((s, f) => s + f.totalTTC, 0);
    const taux = devisTotal ? Number(((devisAccepted / devisTotal) * 100).toFixed(1)) : 0;

    return {
      devisTotal,
      devisAcceptes: devisAccepted,
      devisRefuses: devisRefused,
      tauxAcceptation: taux,
      chiffreAffairesTTC: Number(ca.toFixed(2)),
      impayesTTC: Number(impaye.toFixed(2)),
      facturesImpayeesCount: facturesImpayees.length,
      chantiersEnCours,
    };
  },

  async revenueByMonth({ tenantId, months = 12 }) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const factures = await prisma.facture.findMany({
      where: {
        tenantId,
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
      .map(([month, total]) => ({ month, total: Number(total.toFixed(2)) }));
  },

  async topClients({ tenantId, limit = 10 }) {
    // Regroupe les factures payées par client
    const rows = await prisma.facture.groupBy({
      by: ["clientId"],
      where: { tenantId, status: "PAYEE" },
      _sum: { totalTTC: true },
      orderBy: { _sum: { totalTTC: "desc" } },
      take: limit,
    });

    const clients = await prisma.client.findMany({
      where: { id: { in: rows.map((r) => r.clientId) } },
      select: { id: true, name: true },
    });
    const nameById = Object.fromEntries(clients.map((c) => [c.id, c.name]));

    return rows.map((r) => ({
      clientId: r.clientId,
      clientName: nameById[r.clientId] || "?",
      totalTTC: Number((r._sum.totalTTC || 0).toFixed(2)),
    }));
  },
};

module.exports = { statsService };