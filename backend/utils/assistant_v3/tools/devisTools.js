// Bonus — Refactor des tools pour utiliser les services
// Pour respecter le principe "une seule source de vérité", tu peux maintenant remplacer la logique inline des tools par des appels aux services. Exemple pour devisTools.js :

const { registerTool } = require('../core/toolRegistry');
const { devisService } = require('../services/devisService');
const { prisma } = require('../services/prisma');
const { generatePdf } = require('../services/pdf');
const { mailService } = require('../services/mailService');

function computeTotals(lignes) {
  let ht = 0;
  let tva = 0;
  for (const l of lignes) {
    const ligneTotal = l.quantite * l.prixUnitaire;
    ht += ligneTotal;
    tva += ligneTotal * ((l.tva ?? 20) / 100);
  }
  return { ht, tva, ttc: ht + tva };
}

async function nextNumeroDevis(tenantId) {
  const count = await prisma.devis.count({ where: { tenantId } });
  const year = new Date().getFullYear();
  return `DEV-${year}-${String(count + 1).padStart(4, "0")}`;
}

// search devis
registerTool({
  name: "search_devis",
  description: "Recherche des devis par client, statut ou période.",
  parameters: {
    type: "object",
    properties: {
      clientName: { type: "string" },
      status: { type: "string", enum: ["BROUILLON", "ENVOYE", "ACCEPTE", "REFUSE"] },
      from: { type: "string", description: "ISO date" },
      to: { type: "string" },
    },
  },
  scope: "devis",
  write: false,
  // handler: async (args, ctx) =>
  //   devisService.list({ tenantId: ctx.tenantId, ...args }),
  handler: async (args, ctx) => {
    return prisma.devis.findMany({
      where: {
        tenantId: ctx.tenantId,          // 🔒 isolation multi-tenant
        ...(args.status && { status: args.status }),
        ...(args.clientName && { client: { name: { contains: args.clientName, mode: "insensitive" } } }),
        ...(args.from && { createdAt: { gte: new Date(args.from) } }),
        ...(args.to && { createdAt: { lte: new Date(args.to) } }),
      },
      include: { client: true, lignes: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  },
});

// get devis
registerTool({
  name: "get_devis",
  description: "Récupère un devis complet par son identifiant.",
  parameters: {
    type: "object",
    properties: { devisId: { type: "string" } },
    required: ["devisId"],
  },
  scope: "devis",
  write: false,
  handler: async (args, ctx) => {
    const devis = await prisma.devis.findFirst({
      where: { id: args.devisId, tenantId: ctx.tenantId },
      include: { client: true, lignes: true },
    });
    if (!devis) throw new Error("Devis introuvable");
    return devis;
  },
});

// create devis
registerTool({
  name: "create_devis",
  description: "Crée un nouveau devis.",
  parameters: {
    type: "object",
    properties: {
      clientId: { type: "string" },
      notes: { type: "string" },
      lignes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantite: { type: "number" },
            prixUnitaire: { type: "number" },
            tva: { type: "number" },
          },
          required: ["description", "quantite", "prixUnitaire"],
        },
      },
    },
    required: ["clientId", "lignes"],
  },
  scope: "devis",
  write: true,
  handler: async (args, ctx) => {
    const totalHT = args.lignes.reduce((s,l) => s + l.quantite*l.prixUnitaire, 0);
    // const devis = await devisService.create({
    //   tenantId: ctx.tenantId,
    //   userId: ctx.userId,
    //   data: args,
    // });
    const devis = await prisma.devis.create({
      data: {
        tenantId: ctx.tenantId,
        clientId: args.clientId,
        createdById: ctx.userId,
        status: "BROUILLON",
        totalHT,
        notes: args.notes,
        lignes: { create: args.lignes.map(l => ({...l, total: l.quantite*l.prixUnitaire})) },
      },
      include: { lignes: true, client: true },
    });
    return {
      id: devis.id,
      numero: devis.numero,
      totalHT: devis.totalHT,
      totalTTC: devis.totalTTC,
    };
  },
  // handler: async (args, ctx) => {
  //   const client = await prisma.client.findFirst({
  //     where: { id: args.clientId, tenantId: ctx.tenantId },
  //   });
  //   if (!client) throw new Error("Client introuvable dans ce tenant");

  //   const { ht, tva, ttc } = computeTotals(args.lignes);
  //   const numero = await nextNumeroDevis(ctx.tenantId);

  //   const devis = await prisma.devis.create({
  //     data: {
  //       tenantId: ctx.tenantId,
  //       numero,
  //       clientId: args.clientId,
  //       createdById: ctx.userId,
  //       status: "BROUILLON",
  //       notes: args.notes,
  //       totalHT: ht,
  //       totalTVA: tva,
  //       totalTTC: ttc,
  //       lignes: {
  //         create: args.lignes.map((l) => ({
  //           description: l.description,
  //           quantite: l.quantite,
  //           prixUnitaire: l.prixUnitaire,
  //           tva: l.tva ?? 20,
  //           total: l.quantite * l.prixUnitaire,
  //         })),
  //       },
  //     },
  //     include: { lignes: true, client: true },
  //   });

  //   return { id: devis.id, numero: devis.numero, totalHT: devis.totalHT, totalTTC: devis.totalTTC };
  // },
  // handler: async (args, ctx) => {
  //   const client = await prisma.client.findFirst({
  //     where: { id: args.clientId, tenantId: ctx.tenantId },
  //   });
  //   if (!client) throw new Error("Client introuvable dans ce tenant");

  //   const { ht, tva, ttc } = computeTotals(args.lignes);
  //   const numero = await nextNumeroDevis(ctx.tenantId);

  //   const devis = await prisma.devis.create({
  //     data: {
  //       tenantId: ctx.tenantId,
  //       numero,
  //       clientId: args.clientId,
  //       createdById: ctx.userId,
  //       status: "BROUILLON",
  //       notes: args.notes,
  //       totalHT: ht,
  //       totalTVA: tva,
  //       totalTTC: ttc,
  //       lignes: {
  //         create: args.lignes.map((l) => ({
  //           description: l.description,
  //           quantite: l.quantite,
  //           prixUnitaire: l.prixUnitaire,
  //           tva: l.tva ?? 20,
  //           total: l.quantite * l.prixUnitaire,
  //         })),
  //       },
  //     },
  //     include: { lignes: true, client: true },
  //   });
});

// send devis by email
registerTool({
  name: "send_devis_by_email",
  description:
    "Génère le PDF du devis et l'envoie au client par email. ACTION SENSIBLE : mise en attente de confirmation.",
  parameters: {
    type: "object",
    properties: { devisId: { type: "string" } },
    required: ["devisId"],
  },
  scope: "mail",
  write: true,
  requiresConfirmation: true,
  summarize: async (args, ctx) => {
    const devis = await prisma.devis.findFirst({
      where: { id: args.devisId, tenantId: ctx.tenantId },
      include: { client: true },
    });
    if (!devis) throw new Error("Devis introuvable");
    if (!devis.client.email) throw new Error("Le client n'a pas d'email");

    return `Envoi du devis ${devis.numero} à ${devis.client?.name || "client"} <${devis.client?.email || "?"}>`;
  },
  handler: async (args, ctx) =>
    devisService.sendByEmail({ tenantId: ctx.tenantId, devisId: args.devisId }),
  // handler: async (args, ctx) => {
    
  //   if (!devis) throw new Error("Devis introuvable");
  //   const pdf = await generatePdf(devis);
  //   await mailService.send({ to: devis.client.email, pdf, subject: `Devis ${devis.numero}` });
  //   await prisma.devis.update({ where: { id: devis.id }, data: { status: "ENVOYE", sentAt: new Date() }});
  //   return { sent: true, to: devis.client.email };
  // },
  // handler: async (args, ctx) => {
  //   const devis = await prisma.devis.findFirst({
  //     where: { id: args.devisId, tenantId: ctx.tenantId },
  //     include: { client: true, lignes: true },
  //   });
  //   if (!devis) throw new Error("Devis introuvable");
  //   if (!devis.client.email) throw new Error("Le client n'a pas d'email");

  //   const pdf = await generatePdf(devis);

  //   // Import dynamique pour éviter les cycles
  //   const { mailService } = await import("../../express/services/mailService.js");
  //   await mailService.send({
  //     tenantId: ctx.tenantId,
  //     to: devis.client.email,
  //     subject: `Devis ${devis.numero}`,
  //     body: `Bonjour ${devis.client.name},\n\nVeuillez trouver ci-joint le devis ${devis.numero}.\n\nCordialement.`,
  //     attachments: [{ filename: `${devis.numero}.pdf`, content: pdf }],
  //   });

  //   await prisma.devis.update({
  //     where: { id: devis.id },
  //     data: { status: "ENVOYE", sentAt: new Date() },
  //   });

  //   return { sent: true, to: devis.client.email, numero: devis.numero };
  // },
  // handler: async (args, ctx) => {
  //   const devis = await prisma.devis.findFirst({
  //     where: { id: args.devisId, tenantId: ctx.tenantId },
  //     include: { client: true, lignes: true },
  //   });
  //   if (!devis) throw new Error("Devis introuvable");
  //   if (!devis.client.email) throw new Error("Le client n'a pas d'email");

  //   const pdf = await generatePdf(devis);

  //   await mailService.send({
  //     tenantId: ctx.tenantId,
  //     to: devis.client.email,
  //     subject: `Devis ${devis.numero}`,
  //     body: `Bonjour ${devis.client.name},\n\nVeuillez trouver ci-joint le devis ${devis.numero}.\n\nCordialement.`,
  //     attachments: [{ filename: `${devis.numero}.pdf`, content: pdf }],
  //   });

  //   await prisma.devis.update({
  //     where: { id: devis.id },
  //     data: { status: "ENVOYE", sentAt: new Date() },
  //   });

  //   return { sent: true, to: devis.client.email, numero: devis.numero };
  // },
});

// update devis status
registerTool({
  name: "update_devis_status",
  description: "Change le statut d'un devis (BROUILLON, ENVOYE, ACCEPTE, REFUSE).",
  parameters: {
    type: "object",
    properties: {
      devisId: { type: "string" },
      status: { type: "string", enum: ["BROUILLON", "ENVOYE", "ACCEPTE", "REFUSE"] },
    },
    required: ["devisId", "status"],
  },
  scope: "devis",
  write: true,
  handler: async (args, ctx) => {
    const devis = await prisma.devis.findFirst({
      where: { id: args.devisId, tenantId: ctx.tenantId },
    });
    if (!devis) throw new Error("Devis introuvable");
    return prisma.devis.update({
      where: { id: args.devisId },
      data: { status: args.status },
    });
  },
});
