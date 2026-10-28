// agents/core/pendingActionService.js
const { prisma } = require('../../../services/prisma');

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

const pendingActionService = {
  /**
   * Crée une action en attente de confirmation.
   * Annule d'abord toutes les pending actives de la même session (une seule à la fois).
   */
  async create({ tenantId, userId, sessionId, toolName, args, summary, ttlMs }) {
    await prisma.pendingAction.updateMany({
      where: { sessionId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    return prisma.pendingAction.create({
      data: {
        tenantId,
        userId,
        sessionId,
        toolName,
        args,
        summary,
        status: "PENDING",
        expiresAt: new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)),
      },
    });
  },

  /**
   * Récupère l'action PENDING active d'une session (non expirée).
   * Marque automatiquement comme EXPIRED celles qui sont périmées.
   */
  async getActiveForSession(sessionId) {
    // On nettoie les expirées au passage
    await prisma.pendingAction.updateMany({
      where: { sessionId, status: "PENDING", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });

    return prisma.pendingAction.findFirst({
      where: { sessionId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(id, { userId, tenantId }) {
    return prisma.pendingAction.findFirst({
      where: { id, userId, tenantId },
    });
  },

  async markConfirmed(id) {
    return prisma.pendingAction.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });
  },

  async markCancelled(id) {
    return prisma.pendingAction.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  },

  async markFailed(id, error) {
    return prisma.pendingAction.update({
      where: { id },
      data: { status: "FAILED", error: String(error).slice(0, 500) },
    });
  },

  async list({ userId, tenantId, status = "PENDING" }) {
    return prisma.pendingAction.findMany({
      where: { userId, tenantId, status },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },
};

module.exports = { pendingActionService };