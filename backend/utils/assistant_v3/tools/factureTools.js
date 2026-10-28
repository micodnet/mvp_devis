// agents/tools/factureTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');

async function nextNumeroFacture(tenantId) {
  const count = await prisma.facture.count({ where: { tenantId } });
  const year = new Date().getFullYear();
  return `FAC-${year}-${String(count + 1).padStart(4, "0")}`;
}

registerTool({
  name: "search_factures",
  description: "Recherche des factures par client, statut ou période.",
  parameters: {
    type: "object",
    properties: {
      clientName: { type: "string" },
      status: { type: "string", enum: ["IMPAYEE", "PAYEE", "RETARD"] },
      from: { type: "string" },
      to: { type: "string" },
    },
  },
  scope: "facture",
  write: false,
  handler: async (args, ctx) => {
    return prisma.facture.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(args.status && { status: args.status }),
        ...(args.clientName && {
          client: { name: { contains: args.clientName, mode: "insensitive" } },
        }),
        ...(args.from || args.to
          ? {
              createdAt: {
                ...(args.from && { gte: new Date(args.from) }),
                ...(args.to && { lte: new Date(args.to) }),
              },
            }
          : {}),
      },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },
});

registerTool({
  name: "create_facture_from_devis",
  description: "Crée une facture à partir d'un devis accepté.",
  parameters: {
    type: "object",
    properties: {
      devisId: { type: "string" },
      dueInDays: { type: "number", description: "Échéance en jours (défaut 30)" },
    },
    required: ["devisId"],
  },
  scope: "facture",
  write: true,
  handler: async (args, ctx) => {
    const devis = await prisma.devis.findFirst({
      where: { id: args.devisId, tenantId: ctx.tenantId },
      include: { client: true },
    });
    if (!devis) throw new Error("Devis introuvable");
    if (devis.status !== "ACCEPTE") throw new Error("Le devis doit être ACCEPTE");

    const numero = await nextNumeroFacture(ctx.tenantId);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (args.dueInDays ?? 30));

    const facture = await prisma.facture.create({
      data: {
        tenantId: ctx.tenantId,
        numero,
        clientId: devis.clientId,
        devisId: devis.id,
        status: "IMPAYEE",
        totalHT: devis.totalHT,
        totalTVA: devis.totalTVA,
        totalTTC: devis.totalTTC,
        dueDate,
      },
    });

    return { id: facture.id, numero: facture.numero, totalTTC: facture.totalTTC };
  },
});

registerTool({
  name: "mark_facture_paid",
  description: "Marque une facture comme payée. ACTION SENSIBLE : mise en attente de confirmation.",
  parameters: {
    type: "object",
    properties: { factureId: { type: "string" } },
    required: ["factureId"],
  },
  scope: "facture",
  write: true,
  requiresConfirmation: true,
  summarize: async (args, ctx) => {
    const f = await prisma.facture.findFirst({
      where: { id: args.factureId, tenantId: ctx.tenantId },
    });
    if (!f) return `Marquage d'une facture comme payée (id: ${args.factureId})`;
    return `Marquage de la facture ${f.numero} (${f.totalTTC.toFixed(2)} €) comme PAYÉE`;
  },
  handler: async (args, ctx) => {
    const f = await prisma.facture.findFirst({
      where: { id: args.factureId, tenantId: ctx.tenantId },
    });
    if (!f) throw new Error("Facture introuvable");
    return prisma.facture.update({
      where: { id: args.factureId },
      data: { status: "PAYEE", paidAt: new Date() },
    });
  },
});