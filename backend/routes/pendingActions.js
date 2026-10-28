// express/routes/pendingActions.js
const express = require('express');
const { getTool } = require('../utils/assistant_v3/core/toolRegistry.js');
const { pendingActionService } = require('../utils/assistant_v3/core/pendingActionService.js');
const { authenticateToken } = require('../middleware/auth.js');

const router = express.Router();

/**
 * Liste les actions en attente de l'utilisateur courant.
 * GET /api/pending-actions?status=PENDING
 */
router.get("/pending-actions", authenticateToken, async (req, res) => {
  try {
    const status = req.query.status || "PENDING";
    const list = await pendingActionService.list({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      status,
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Détail d'une action.
 * GET /api/pending-actions/:id
 */
router.get("/pending-actions/:id", authenticateToken, async (req, res) => {
  const pending = await pendingActionService.getById(req.params.id, {
    userId: req.user.id,
    tenantId: req.user.tenantId,
  });
  if (!pending) return res.status(404).json({ error: "Action introuvable" });
  res.json(pending);
});

/**
 * CONFIRMER une action → exécution réelle du tool.
 * POST /api/pending-actions/:id/confirm
 */
router.post("/pending-actions/:id/confirm", authenticateToken, async (req, res) => {
  const pending = await pendingActionService.getById(req.params.id, {
    userId: req.user.id,
    tenantId: req.user.tenantId,
  });

  if (!pending) return res.status(404).json({ error: "Action introuvable" });

  if (pending.status !== "PENDING") {
    return res.status(409).json({ error: `Action déjà traitée (statut: ${pending.status})` });
  }

  if (pending.expiresAt < new Date()) {
    await pendingActionService.markCancelled(pending.id);
    return res.status(410).json({ error: "Action expirée" });
  }

  const def = getTool(pending.toolName);
  if (!def) {
    await pendingActionService.markFailed(pending.id, "Tool introuvable");
    return res.status(400).json({ error: "Tool inconnu" });
  }

  const ctx = {
    userId: req.user.id,
    tenantId: req.user.tenantId,
    role: req.user.role,
    sessionId: pending.sessionId,
  };

  try {
    const data = await def.handler(pending.args, ctx);
    await pendingActionService.markConfirmed(pending.id);
    res.json({ ok: true, summary: pending.summary, result: data });
  } catch (e) {
    await pendingActionService.markFailed(pending.id, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * ANNULER une action.
 * POST /api/pending-actions/:id/cancel
 */
router.post("/pending-actions/:id/cancel", authenticateToken, async (req, res) => {
  const pending = await pendingActionService.getById(req.params.id, {
    userId: req.user.id,
    tenantId: req.user.tenantId,
  });

  if (!pending) return res.status(404).json({ error: "Action introuvable" });
  if (pending.status !== "PENDING") {
    return res.status(409).json({ error: `Action déjà traitée (statut: ${pending.status})` });
  }

  await pendingActionService.markCancelled(pending.id);
  res.json({ ok: true, cancelled: true });
});

module.exports = router;


// /**
//  * Liste les actions en attente de l'utilisateur courant.
//  * GET /api/pending-actions?status=PENDING
//  */
// router.get("/pending-actions", authMiddleware, async (req, res) => {
//   try {
//     const status = req.query.status || "PENDING";
//     const list = await pendingActionService.list({
//       userId: req.user.id,
//       tenantId: req.user.tenantId,
//       status,
//     });
//     res.json(list);
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

// /**
//  * Détail d'une action.
//  * GET /api/pending-actions/:id
//  */
// router.get("/pending-actions/:id", authMiddleware, async (req, res) => {
//   const pending = await pendingActionService.getById(req.params.id, {
//     userId: req.user.id,
//     tenantId: req.user.tenantId,
//   });
//   if (!pending) return res.status(404).json({ error: "Action introuvable" });
//   res.json(pending);
// });

// /**
//  * CONFIRMER une action → exécution réelle du tool.
//  * POST /api/pending-actions/:id/confirm
//  */
// router.post("/pending-actions/:id/confirm", authMiddleware, async (req, res) => {
//   const pending = await pendingActionService.getById(req.params.id, {
//     userId: req.user.id,
//     tenantId: req.user.tenantId,
//   });

//   if (!pending) return res.status(404).json({ error: "Action introuvable" });
//   if (pending.status !== "PENDING") {
//     return res.status(409).json({ error: `Action déjà traitée (statut: ${pending.status})` });
//   }
//   if (new Date(pending.expiresAt) < new Date()) {
//     await pendingActionService.markCancelled(pending.id);
//     return res.status(410).json({ error: "Action expirée" });
//   }

//   const def = getTool(pending.toolName);
//   if (!def) {
//     await pendingActionService.markFailed(pending.id, "Tool introuvable");
//     return res.status(400).json({ error: "Tool inconnu" });
//   }

//   const ctx = {
//     userId: req.user.id,
//     tenantId: req.user.tenantId,
//     role: req.user.role,
//     sessionId: pending.sessionId,
//   };

//   try {
//     const data = await def.handler(pending.args, ctx);
//     await pendingActionService.markConfirmed(pending.id);
//     res.json({ ok: true, summary: pending.summary, result: data });
//   } catch (e) {
//     await pendingActionService.markFailed(pending.id, e.message);
//     res.status(500).json({ ok: false, error: e.message });
//   }
// });

// /**
//  * ANNULER une action.
//  * POST /api/pending-actions/:id/cancel
//  */
// router.post("/pending-actions/:id/cancel", authMiddleware, async (req, res) => {
//   const pending = await pendingActionService.getById(req.params.id, {
//     userId: req.user.id,
//     tenantId: req.user.tenantId,
//   });

//   if (!pending) return res.status(404).json({ error: "Action introuvable" });
//   if (pending.status !== "PENDING") {
//     return res.status(409).json({ error: `Action déjà traitée (statut: ${pending.status})` });
//   }

//   await pendingActionService.markCancelled(pending.id);
//   res.json({ ok: true, cancelled: true });
// });

// export default router;