// backend/routes/reports.js
// Routes pour la generation de rapports PDF

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { generateReport, loadReportData } = require('../utils/reports/generator');

const router = express.Router();

// ============================================================
// GET /api/reports/pdf — Genere un rapport PDF
// Query : ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================
router.get('/pdf', authenticateToken, async (req, res) => {
    try {
        let { from, to } = req.query;

        // Par defaut : mois en cours
        if (!from || !to) {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            from = firstDay.toISOString().slice(0, 10);
            to = lastDay.toISOString().slice(0, 10);
        }

        // Validation basique
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: 'Format de date invalide (attendu YYYY-MM-DD).' });
        }

        const pdfBytes = await generateReport(req.user.id, from, to);

        const filename = 'rapport-' + from + '-au-' + to + '.pdf';

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        res.setHeader('Content-Length', pdfBytes.length);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Erreur generation rapport:', err);
        res.status(500).json({ error: err.message || 'Erreur generation rapport.' });
    }
});

// ============================================================
// GET /api/reports/preview — Retourne les donnees sans generer le PDF
// ============================================================
router.get('/preview', authenticateToken, async (req, res) => {
    try {
        let { from, to } = req.query;

        if (!from || !to) {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            from = firstDay.toISOString().slice(0, 10);
            to = lastDay.toISOString().slice(0, 10);
        }

        const data = await loadReportData(req.user.id, from, to);
        res.json(data);
    } catch (err) {
        console.error('Erreur preview rapport:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;