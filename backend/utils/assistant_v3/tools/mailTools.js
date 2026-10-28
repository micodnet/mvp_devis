// agents/tools/mailTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');
const { mailService } = require('../services/mailService');

registerTool({
  name: "send_email",
  description:
    "Envoie un email brut à un destinataire. ACTION SENSIBLE : mise en attente de confirmation.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["to", "subject", "body"],
  },
  scope: "mail",
  write: true,
  requiresConfirmation: true,
  summarize: (args) =>
    `Envoi d'un email à ${args.to} — sujet : "${args.subject}"`,
  handler: async (args, ctx) => {
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(args.to)) {
      throw new Error("Email destinataire invalide");
    }
    return mailService.send({
      tenantId: ctx.tenantId,
      to: args.to,
      subject: args.subject,
      body: args.body,
    });
  },
});

registerTool({
  name: "send_relance_for_facture",
  description:
    "Envoie un email de relance pour une facture impayée. ACTION SENSIBLE : mise en attente de confirmation.",
  parameters: {
    type: "object",
    properties: { factureId: { type: "string" } },
    required: ["factureId"],
  },
  scope: "mail",
  write: true,
  requiresConfirmation: true,
  summarize: async (args, ctx) => {
    const f = await prisma.facture.findFirst({
      where: { id: args.factureId, tenantId: ctx.tenantId },
      include: { client: true },
    });
    if (!f) return `Relance d'une facture (id: ${args.factureId})`;
    return `Relance de la facture ${f.numero} à ${f.client?.name || "client"} <${f.client?.email || "?"}>`;
  },
  handler: async (args, ctx) => {
    const facture = await prisma.facture.findFirst({
      where: { id: args.factureId, tenantId: ctx.tenantId },
      include: { client: true },
    });
    if (!facture) throw new Error("Facture introuvable");
    if (!facture.client.email) throw new Error("Le client n'a pas d'email");

    const body = `Bonjour ${facture.client.name},\n\nSauf erreur, la facture ${facture.numero} d'un montant de ${facture.totalTTC.toFixed(2)} € reste impayée.\n\nNous vous remercions de bien vouloir procéder au règlement.\n\nCordialement.`;

    await mailService.send({
      tenantId: ctx.tenantId,
      to: facture.client.email,
      subject: `Relance – Facture ${facture.numero}`,
      body,
    });

    return { sent: true, to: facture.client.email, numero: facture.numero };
  },
});