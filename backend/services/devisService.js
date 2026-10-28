// express/services/devisService.js
const { prisma } = require('../services/prisma');
const { NotFound, BadRequest } = require('../errors/AppError');
const { generatePdf } = require('../services/pdf');
const { mailService } = require('../services/mailService');

function computeTotals(lignes) {
  let ht = 0;
  let tva = 0;
  for (const l of lignes) {
    const total = l.quantite * l.prixUnitaire;
    ht += total;
    tva += total * ((l.tva ?? 20) / 100);
  }
  return { ht, tva, ttc: ht + tva };
}

async function nextNumero(tenantId) {
  const count = await prisma.devis.count({ where: { tenantId } });
  const year = new Date().getFullYear();
  return `DEV-${year}-${String(count + 1).padStart(4, "0")}`;
}

const devisService = {
  async list({ tenantId, clientName, status, from, to, take = 100 }) {
    return prisma.devis.findMany({
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
      include: { client: true, lignes: true },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  async get({ tenantId, devisId }) {
    const devis = await prisma.devis.findFirst({
      where: { id: devisId, tenantId },
      include: { client: true, lignes: true },
    });
    if (!devis) throw NotFound("Devis introuvable");
    return devis;
  },

  async create({ tenantId, userId, data }) {
    if (!data.clientId) throw BadRequest("clientId requis");
    if (!Array.isArray(data.lignes) || data.lignes.length === 0) {
      throw BadRequest("Au moins une ligne est requise");
    }

    const client = await prisma.client.findFirst({
      where: { id: data.clientId, tenantId },
    });
    if (!client) throw NotFound("Client introuvable dans ce tenant");

    const { ht, tva, ttc } = computeTotals(data.lignes);
    const numero = await nextNumero(tenantId);

    return prisma.devis.create({
      data: {
        tenantId,
        numero,
        clientId: data.clientId,
        createdById: userId,
        status: "BROUILLON",
        notes: data.notes,
        totalHT: ht,
        totalTVA: tva,
        totalTTC: ttc,
        lignes: {
          create: data.lignes.map((l) => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaire: l.prixUnitaire,
            tva: l.tva ?? 20,
            total: l.quantite * l.prixUnitaire,
          })),
        },
      },
      include: { lignes: true, client: true },
    });
  },

  async update({ tenantId, devisId, data }) {
    const devis = await this.get({ tenantId, devisId });

    // On n'autorise pas la modif d'un devis déjà envoyé/accepté/refusé
    if (devis.status !== "BROUILLON") {
      throw BadRequest("Seuls les devis BROUILLON sont modifiables");
    }

    // Si on remplace les lignes, on recalcule
    let totals = {};
    let lignesUpdate = undefined;

    if (Array.isArray(data.lignes)) {
      const { ht, tva, ttc } = computeTotals(data.lignes);
      totals = { totalHT: ht, totalTVA: tva, totalTTC: ttc };
      lignesUpdate = {
        deleteMany: {},
        create: data.lignes.map((l) => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          tva: l.tva ?? 20,
          total: l.quantite * l.prixUnitaire,
        })),
      };
    }

    return prisma.devis.update({
      where: { id: devisId },
      data: {
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.clientId && { clientId: data.clientId }),
        ...totals,
        ...(lignesUpdate && { lignes: lignesUpdate }),
      },
      include: { lignes: true, client: true },
    });
  },

  async updateStatus({ tenantId, devisId, status }) {
    const allowed = ["BROUILLON", "ENVOYE", "ACCEPTE", "REFUSE"];
    if (!allowed.includes(status)) throw BadRequest("Statut invalide");
    await this.get({ tenantId, devisId });
    return prisma.devis.update({
      where: { id: devisId },
      data: { status },
    });
  },

  async remove({ tenantId, devisId }) {
    const devis = await this.get({ tenantId, devisId });
    if (devis.status !== "BROUILLON") {
      throw BadRequest("Seuls les devis BROUILLON peuvent être supprimés");
    }
    await prisma.devis.delete({ where: { id: devisId } });
    return { deleted: true };
  },

  /**
   * Envoi du devis au client (PDF + email).
   * Appelé soit par le tool `send_devis_by_email`, soit par la route de confirmation.
   */
  async sendByEmail({ tenantId, devisId }) {
    const devis = await this.get({ tenantId, devisId });
    if (!devis.client.email) throw BadRequest("Le client n'a pas d'email");

    const pdf = await generatePdf(devis);

    await mailService.send({
      tenantId,
      to: devis.client.email,
      subject: `Devis ${devis.numero}`,
      body: `Bonjour ${devis.client.name},\n\nVeuillez trouver ci-joint le devis ${devis.numero}.\n\nCordialement.`,
      attachments: [{ filename: `${devis.numero}.pdf`, content: pdf }],
    });

    await prisma.devis.update({
      where: { id: devisId },
      data: { status: "ENVOYE", sentAt: new Date() },
    });

    return { sent: true, to: devis.client.email, numero: devis.numero };
  },
};

module.exports = { devisService };