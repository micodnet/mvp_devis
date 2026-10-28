// express/services/clientService.js
const { prisma } = require('../services/prisma');
const { NotFound, Conflict } = require('../errors/AppError');

const clientService = {
  async list({ tenantId, search }) {
    return prisma.client.findMany({
      where: {
        tenantId,
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  async get({ tenantId, clientId }) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, tenantId },
      include: {
        devis: { orderBy: { createdAt: "desc" }, take: 10 },
        factures: { orderBy: { createdAt: "desc" }, take: 10 },
        chantiers: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!client) throw NotFound("Client introuvable");
    return client;
  },

  async create({ tenantId, data }) {
    if (!data.name) throw new Error("Nom requis");
    // Anti-doublon simple sur email
    if (data.email) {
      const existing = await prisma.client.findFirst({
        where: { tenantId, email: { equals: data.email, mode: "insensitive" } },
      });
      if (existing) throw Conflict(`Un client avec l'email ${data.email} existe déjà`);
    }
    return prisma.client.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
      },
    });
  },

  async update({ tenantId, clientId, data }) {
    await this.get({ tenantId, clientId });
    const { id, tenantId: _t, createdAt: _c, ...rest } = data;
    return prisma.client.update({ where: { id: clientId }, data: rest });
  },

  async remove({ tenantId, clientId }) {
    await this.get({ tenantId, clientId });

    // Vérification des dépendances
    const [devisCount, factureCount, chantierCount] = await Promise.all([
      prisma.devis.count({ where: { clientId } }),
      prisma.facture.count({ where: { clientId } }),
      prisma.chantier.count({ where: { clientId } }),
    ]);
    if (devisCount + factureCount + chantierCount > 0) {
      throw Conflict(
        "Impossible : le client a des devis, factures ou chantiers associés"
      );
    }

    await prisma.client.delete({ where: { id: clientId } });
    return { deleted: true };
  },
};

module.exports = { clientService };