// agents/tools/chantierTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');

registerTool({
  name: "search_chantiers",
  description: "Recherche des chantiers par client ou statut.",
  parameters: {
    type: "object",
    properties: {
      clientName: { type: "string" },
      status: { type: "string", enum: ["PLANIFIE", "EN_COURS", "TERMINE", "ANNULE"] },
    },
  },
  scope: "chantier",
  write: false,
  handler: async (args, ctx) => {
    return prisma.chantier.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(args.status && { status: args.status }),
        ...(args.clientName && {
          client: { name: { contains: args.clientName, mode: "insensitive" } },
        }),
      },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  },
});

registerTool({
  name: "create_chantier",
  description: "Crée un nouveau chantier pour un client.",
  parameters: {
    type: "object",
    properties: {
      clientId: { type: "string" },
      nom: { type: "string" },
      adresse: { type: "string" },
      debut: { type: "string", description: "Date ISO" },
      fin: { type: "string" },
      budget: { type: "number" },
      notes: { type: "string" },
    },
    required: ["clientId", "nom"],
  },
  scope: "chantier",
  write: true,
  handler: async (args, ctx) => {
    const client = await prisma.client.findFirst({
      where: { id: args.clientId, tenantId: ctx.tenantId },
    });
    if (!client) throw new Error("Client introuvable");

    return prisma.chantier.create({
      data: {
        tenantId: ctx.tenantId,
        clientId: args.clientId,
        nom: args.nom,
        adresse: args.adresse,
        debut: args.debut ? new Date(args.debut) : null,
        fin: args.fin ? new Date(args.fin) : null,
        budget: args.budget,
        notes: args.notes,
        status: "PLANIFIE",
      },
    });
  },
});

registerTool({
  name: "update_chantier_status",
  description: "Change le statut d'un chantier.",
  parameters: {
    type: "object",
    properties: {
      chantierId: { type: "string" },
      status: { type: "string", enum: ["PLANIFIE", "EN_COURS", "TERMINE", "ANNULE"] },
    },
    required: ["chantierId", "status"],
  },
  scope: "chantier",
  write: true,
  handler: async (args, ctx) => {
    const c = await prisma.chantier.findFirst({
      where: { id: args.chantierId, tenantId: ctx.tenantId },
    });
    if (!c) throw new Error("Chantier introuvable");
    return prisma.chantier.update({
      where: { id: args.chantierId },
      data: { status: args.status },
    });
  },
});