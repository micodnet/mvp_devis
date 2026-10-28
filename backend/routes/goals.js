// express/routes/goals.js
const { Router } = require('express');
const { prisma } = require('../services/prisma');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = Router();

router.get(
  "/goals",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const goals = await prisma.goal.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(req.query.status && { status: req.query.status }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(goals);
  })
);

module.exports = router;