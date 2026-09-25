// backend/routes/stats.js
// Routes pour les statistiques avancées

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const analytics = require('../utils/stats/analytics');

const router = express.Router();

// ============================================================
// GET /api/stats/kpi — KPI Dashboard global
// ============================================================
router.get('/kpi', authenticateToken, async (req, res) => {
    try {
        const kpi = await analytics.getKPIDashboard(req.user.id);
        res.json(kpi);
    } catch (err) {
        console.error('Erreur KPI:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/profitability/by-metier
// ============================================================
router.get('/profitability/by-metier', authenticateToken, async (req, res) => {
    try {
        const { from, to } = req.query;
        const data = await analytics.getProfitabilityByMetier(req.user.id, from, to);
        res.json(data);
    } catch (err) {
        console.error('Erreur profitabilité métier:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/profitability/by-client
// ============================================================
router.get('/profitability/by-client', authenticateToken, async (req, res) => {
    try {
        const { from, to, limit } = req.query;
        const data = await analytics.getProfitabilityByClient(req.user.id, from, to, parseInt(limit) || 20);
        res.json(data);
    } catch (err) {
        console.error('Erreur profitabilité client:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/conversion
// ============================================================
router.get('/conversion', authenticateToken, async (req, res) => {
    try {
        const { from, to } = req.query;
        const data = await analytics.getConversionStats(req.user.id, from, to);
        res.json(data);
    } catch (err) {
        console.error('Erreur conversion:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/treasury
// ============================================================
router.get('/treasury', authenticateToken, async (req, res) => {
    try {
        const data = await analytics.getTreasuryForecast(req.user.id);
        res.json(data);
    } catch (err) {
        console.error('Erreur trésorerie:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/top-products
// ============================================================
router.get('/top-products', authenticateToken, async (req, res) => {
    try {
        const { from, to, limit } = req.query;
        const data = await analytics.getTopProducts(req.user.id, from, to, parseInt(limit) || 15);
        res.json(data);
    } catch (err) {
        console.error('Erreur top produits:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/stats/temporal
// ============================================================
router.get('/temporal', authenticateToken, async (req, res) => {
    try {
        const { from, to, groupBy } = req.query;
        const data = await analytics.getTemporalStats(req.user.id, from, to, groupBy || 'month');
        res.json(data);
    } catch (err) {
        console.error('Erreur temporel:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;