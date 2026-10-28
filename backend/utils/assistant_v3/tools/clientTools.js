// agents/tools/clientTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');

registerTool({
  name: "search_client",
  description: "Recherche un client par nom ou email dans le tenant courant.",
  parameters: {
    type: "object",
    properties: {
      name:  { type: "string", description: "Nom (partiel accepté)" },
      email: { type: "string" },
    },
  },
  scope: "client",
  write: false,
  handler: async (args, ctx) => {
    return prisma.client.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(args.name && { name: { contains: args.name, mode: "insensitive" } }),
        ...(args.email && { email: { equals: args.email, mode: "insensitive" } }),
      },
      take: 20,
    });
  },
});

registerTool({
  name: "create_client",
  description: "Crée un nouveau client. Vérifier les doublons avant.",
  parameters: {
    type: "object",
    properties: {
      name:    { type: "string" },
      email:   { type: "string" },
      phone:   { type: "string" },
      address: { type: "string" },
    },
    required: ["name"],
  },
  scope: "client",
  write: true,
  handler: async (args, ctx) => {
    return prisma.client.create({
      data: {
        tenantId: ctx.tenantId,
        name: args.name,
        email: args.email,
        phone: args.phone,
        address: args.address,
      },
    });
  },
});

registerTool({
  name: "update_client",
  description: "Met à jour les coordonnées d'un client existant.",
  parameters: {
    type: "object",
    properties: {
      clientId: { type: "string" },
      email:    { type: "string" },
      phone:    { type: "string" },
      address:  { type: "string" },
    },
    required: ["clientId"],
  },
  scope: "client",
  write: true,
  handler: async (args, ctx) => {
    const { clientId, ...data } = args;
    const existing = await prisma.client.findFirst({
      where: { id: clientId, tenantId: ctx.tenantId },
    });
    if (!existing) throw new Error("Client introuvable dans ce tenant");
    return prisma.client.update({ where: { id: clientId }, data });
  },
});