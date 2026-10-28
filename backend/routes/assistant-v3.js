// express/routes/assistant.js
const { Router } = require('express');
const { orchestrate } = require('../utils/assistant_v3/core/orchestrator');
const { authenticateToken } = require('../middleware/auth');
const { prisma } = require('../services/prisma');

const router = Router();

router.post("/assistant/ask", authenticateToken, async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message requis" });
  }

  const context = {
    userId: req.user.id,
    tenantId: req.user.tenantId,
    role: req.user.role,
    sessionId: sessionId || `s_${Date.now()}_${req.user.id}`,
  };

  // Server-Sent Events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const result = await orchestrate(message, context, {
      onStep: (step) => send({ type: "step", step }),
      onAgent: (agentName) => send({ type: "agent", agent: agentName }),
      onPending: (pending) =>
        send({
          type: "pending",
          pendingActionId: pending.id,
          summary: pending.summary,
          tool: pending.toolName,
          expiresAt: pending.expiresAt,
        }),
    });

    // Si l'agent a mis une action en attente, on le signale explicitement
    if (result.pendingActionId) {
      send({ type: "pending", pendingActionId: result.pendingActionId });
    }

    // Trace persistée pour audit
    await prisma.agentTrace.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        agent: result.agent || "orchestrator",
        goal: message,
        steps: result.trace || [],
        result: result.answer || result.error || null,
      },
    });

    send({ type: "final", result });
  } catch (e) {
    send({ type: "error", error: e.message });
  } finally {
    res.end();
  }
});


module.exports = router;