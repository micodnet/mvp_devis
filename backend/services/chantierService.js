// express/services/chantierService.js
const { prisma } = require('./prisma.js');
const { NotFound, BadRequest } = require('../errors/AppError');

const chantierService = {
  async list({ tenantId, clientName, status }) {
    return prisma.chantier.findMany({
      where: {
        tenantId,
        ...(status && { status }),
        ...(clientName && {
          client: { name: { contains: clientName, mode: "insensitive" } },
        }),
      },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  async get({ tenantId, chantierId }) {
    const c = await prisma.chantier.findFirst({
      where: { id: chantierId, tenantId },
      include: { client: true },
    });
    if (!c) throw NotFound("Chantier introuvable");
    return c;
  },

  async create({ tenantId, data }) {
    if (!data.clientId || !data.nom) throw BadRequest("clientId et nom requis");

    const client = await prisma.client.findFirst({
      where: { id: data.clientId, tenantId },
    });
    if (!client) throw NotFound("Client introuvable");

    return prisma.chantier.create({
      data: {
        tenantId,
        clientId: data.clientId,
        nom: data.nom,
        adresse: data.adresse,
        debut: data.debut ? new Date(data.debut) : null,
        fin: data.fin ? new Date(data.fin) : null,
        budget: data.budget ?? null,
        notes: data.notes,
        status: "PLANIFIE",
      },
      include: { client: true },
    });
  },

  async update({ tenantId, chantierId, data }) {
    await this.get({ tenantId, chantierId });
    return prisma.chantier.update({
      where: { id: chantierId },
      data: {
        ...(data.nom !== undefined && { nom: data.nom }),
        ...(data.adresse !== undefined && { adresse: data.adresse }),
        ...(data.debut !== undefined && { debut: data.debut ? new Date(data.debut) : null }),
        ...(data.fin !== undefined && { fin: data.fin ? new Date(data.fin) : null }),
        ...(data.budget !== undefined && { budget: data.budget }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: { client: true },
    });
  },

  async updateStatus({ tenantId, chantierId, status }) {
    const allowed = ["PLANIFIE", "EN_COURS", "TERMINE", "ANNULE"];
    if (!allowed.includes(status)) throw BadRequest("Statut invalide");
    await this.get({ tenantId, chantierId });
    return prisma.chantier.update({
      where: { id: chantierId },
      data: { status },
    });
  },

  async remove({ tenantId, chantierId }) {
    await this.get({ tenantId, chantierId });
    await prisma.chantier.delete({ where: { id: chantierId } });
    return { deleted: true };
  },
};

module.exports = { chantierService };