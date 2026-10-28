// express/services/factureService.js
const { prisma } = require('../services/prisma');
const { NotFound, BadRequest } = require('../errors/AppError');

async function nextNumero(tenantId) {
  const count = await prisma.facture.count({ where: { tenantId } });
  const year = new Date().getFullYear();
  return `FAC-${year}-${String(count + 1).padStart(4, "0")}`;
}

const factureService = {
  async list({ tenantId, clientName, status, from, to }) {
    return prisma.facture.findMany({
      where: {
        tenantId,
        ...(status && { status }),
        ...(clientName && {
          client: { name: { contains: clientName, mode: "insensitive" } },
        }),
        ...(from || to
          ? {
              createdAt: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  async get({ tenantId, factureId }) {
    const facture = await prisma.facture.findFirst({
      where: { id: factureId, tenantId },
      include: { client: true },
    });
    if (!facture) throw NotFound("Facture introuvable");
    return facture;
  },

  async createFromDevis({ tenantId, devisId, dueInDays = 30 }) {
    const devis = await prisma.devis.findFirst({
      where: { id: devisId, tenantId },
    });
    if (!devis) throw NotFound("Devis introuvable");
    if (devis.status !== "ACCEPTE") {
      throw BadRequest("Le devis doit être ACCEPTE pour être facturé");
    }

    const numero = await nextNumero(tenantId);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueInDays);

    return prisma.facture.create({
      data: {
        tenantId,
        numero,
        clientId: devis.clientId,
        devisId: devis.id,
        status: "IMPAYEE",
        totalHT: devis.totalHT,
        totalTVA: devis.totalTVA,
        totalTTC: devis.totalTTC,
        dueDate,
      },
      include: { client: true },
    });
  },

  async markPaid({ tenantId, factureId }) {
    const facture = await this.get({ tenantId, factureId });
    if (facture.status === "PAYEE") {
      throw BadRequest("Facture déjà payée");
    }
    return prisma.facture.update({
      where: { id: factureId },
      data: { status: "PAYEE", paidAt: new Date() },
    });
  },

  async remove({ tenantId, factureId }) {
    const f = await this.get({ tenantId, factureId });
    if (f.status === "PAYEE") {
      throw BadRequest("Impossible de supprimer une facture payée");
    }
    await prisma.facture.delete({ where: { id: factureId } });
    return { deleted: true };
  },
};

module.exports = { factureService };