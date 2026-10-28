// agents/tools/supervisorTools.js
const { registerTool } = require('../core/toolRegistry');
const { prisma } = require('../services/prisma');
const { pendingActionService } = require('../core/pendingActionService');

const SYSTEM_USER = "system";

// ─────────────────────────────────────────────────────────────
// Détection d'anomalies (read-only)
// ─────────────────────────────────────────────────────────────

registerTool({
  name: "supervisor_find_overdue_invoices",
  description:
    "Liste les factures impayées dont l'échéance est dépassée depuis au moins N jours.",
  parameters: {
    type: "object",
    properties: { minDaysOverdue: { type: "number", description: "Défaut : 1" } },
  },
  scope: "stats",
  write: false,
  handler: async (args, ctx) => {
    const minDays = args.minDaysOverdue ?? 1;
    const threshold = new Date(Date.now() - minDays * 86400_000);

    return prisma.facture.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "IMPAYEE",
        dueDate: { lt: threshold },
      },
      include: { client: true },
      orderBy: { dueDate: "asc" },
      take: 50,
    });
  },
});

registerTool({
  name: "supervisor_find_stale_devis",
  description:
    "Liste les devis ENVOYÉS sans réponse client depuis au moins N jours (à relancer).",
  parameters: {
    type: "object",
    properties: { minDays: { type: "number", description: "Défaut : 7" } },
  },
  scope: "stats",
  write: false,
  handler: async (args, ctx) => {
    const minDays = args.minDays ?? 7;
    const threshold = new Date(Date.now() - minDays * 86400_000);

    return prisma.devis.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "ENVOYE",
        sentAt: { lt: threshold },
      },
      include: { client: true },
      orderBy: { sentAt: "asc" },
      take: 50,
    });
  },
});

registerTool({
  name: "supervisor_find_chantiers_at_risk",
  description:
    "Liste les chantiers EN_COURS dont la date de fin est dépassée, ou PLANIFIÉS dont le début est dépassé.",
  parameters: { type: "object", properties: {} },
  scope: "stats",
  write: false,
  handler: async (_args, ctx) => {
    const now = new Date();
    const [enRetard, nonDemarres] = await Promise.all([
      prisma.chantier.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: "EN_COURS",
          fin: { lt: now },
        },
        include: { client: true },
      }),
      prisma.chantier.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: "PLANIFIE",
          debut: { lt: now },
        },
        include: { client: true },
      }),
    ]);
    return { enRetard, nonDemarres };
  },
});

registerTool({
  name: "supervisor_snapshot",
  description:
    "Photo globale de l'activité : CA, impayés, devis en cours, chantiers actifs, tendance du mois.",
  parameters: { type: "object", properties: {} },
  scope: "stats",
  write: false,
  handler: async (_args, ctx) => {
    const tenantId = ctx.tenantId;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

    const [
      facturesPayees,
      facturesImpayees,
      devisEnCours,
      devisAccepted30j,
      chantiersActifs,
    ] = await Promise.all([
      prisma.facture.findMany({
        where: { tenantId, status: "PAYEE" },
        select: { totalTTC: true },
      }),
      prisma.facture.findMany({
        where: { tenantId, status: "IMPAYEE" },
        select: { totalTTC: true, dueDate: true },
      }),
      prisma.devis.count({ where: { tenantId, status: "ENVOYE" } }),
      prisma.devis.count({
        where: { tenantId, status: "ACCEPTE", updatedAt: { gte: thirtyDaysAgo } },
      }),
      prisma.chantier.count({ where: { tenantId, status: "EN_COURS" } }),
    ]);

    const ca = facturesPayees.reduce((s, f) => s + f.totalTTC, 0);
    const impaye = facturesImpayees.reduce((s, f) => s + f.totalTTC, 0);
    const impayeEnRetard = facturesImpayees
      .filter((f) => f.dueDate && f.dueDate < now)
      .reduce((s, f) => s + f.totalTTC, 0);

    return {
      chiffreAffairesTTC: Number(ca.toFixed(2)),
      impayesTTC: Number(impaye.toFixed(2)),
      impayesEnRetardTTC: Number(impayeEnRetard.toFixed(2)),
      devisEnAttenteReponse: devisEnCours,
      devisAcceptes30j,
      chantiersEnCours: chantiersActifs,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// Actions à effet de bord
// ─────────────────────────────────────────────────────────────

/**
 * Enregistre un goal (objectif) — utilisé par le superviseur pour se souvenir
 * d'une tâche à suivre sur plusieurs passages du cron.
 */
registerTool({
  name: "supervisor_create_goal",
  description:
    "Crée un objectif durable à suivre. Utilise-le pour tracer une action à mener plus tard.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string" },
      plan: { type: "array", items: { type: "string" } },
    },
    required: ["description"],
  },
  scope: "stats",
  write: true,
  handler: async (args, ctx) => {
    const goal = await prisma.goal.create({
      data: {
        tenantId: ctx.tenantId,
        description: args.description,
        plan: args.plan || null,
        createdBy: ctx.userId || SYSTEM_USER,
        status: "PENDING",
      },
    });
    return { goalId: goal.id };
  },
});

registerTool({
  name: "supervisor_update_goal",
  description: "Met à jour le statut / résultat d'un goal.",
  parameters: {
    type: "object",
    properties: {
      goalId: { type: "string" },
      status: { type: "string", enum: ["PENDING","IN_PROGRESS","DONE","FAILED","CANCELLED"] },
      result: { type: "string" },
    },
    required: ["goalId", "status"],
  },
  scope: "stats",
  write: true,
  handler: async (args, ctx) => {
    const g = await prisma.goal.findFirst({
      where: { id: args.goalId, tenantId: ctx.tenantId },
    });
    if (!g) throw new Error("Goal introuvable");
    return prisma.goal.update({
      where: { id: args.goalId },
      data: { status: args.status, result: args.result },
    });
  },
});

/**
 * Enregistre une action sensible proposée par le superviseur.
 * L'utilisateur la validera via /api/pending-actions/:id/confirm.
 */
registerTool({
  name: "supervisor_propose_action",
  description:
    "Propose une action sensible (envoi mail, relance, changement de statut) qui devra être confirmée par l'utilisateur.",
  parameters: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description: "Nom du tool à exécuter après confirmation (ex: send_relance_for_facture).",
      },
      args: { type: "object", description: "Arguments à passer au tool." },
      summary: { type: "string", description: "Résumé lisible pour l'utilisateur." },
    },
    required: ["toolName", "args", "summary"],
  },
  scope: "stats",
  write: true,
  handler: async (args, ctx) => {
    const pending = await pendingActionService.create({
      tenantId: ctx.tenantId,
      userId: ctx.userId === "system" ? "system" : ctx.userId,
      sessionId: ctx.sessionId,
      toolName: args.toolName,
      args: args.args,
      summary: args.summary,
      ttlMs: 24 * 3600 * 1000, // 24h pour le cron
    });
    return { pendingActionId: pending.id, summary: pending.summary };
  },
});