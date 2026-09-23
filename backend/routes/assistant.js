// backend/routes/assistant.js
// Route de l'assistant conversationnel

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { chat, confirmAction } = require('../utils/assistant/orchestrator');

const router = express.Router();

// ============================================================
// POST /api/assistant/chat — Envoyer un message à l'assistant
// ============================================================
router.post('/chat', authenticateToken, async (req, res) => {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'Message trop long (2000 caractères max).' });
    }

    // 🆕 Valider et nettoyer l'historique (max 10 derniers messages)
    let conversationHistory = [];
    if (Array.isArray(history)) {
        conversationHistory = history
            .filter(m => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
            .slice(-10)
            .map(m => ({
                role: m.role,
                text: m.text.slice(0, 500) // limiter la taille
            }));
    }

    try {
        const result = await chat(message.trim(), req.user.id, conversationHistory);
        res.json(result);
    } catch (err) {
        console.error('Erreur assistant:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/assistant/confirm — Confirmer une action préparée
// ============================================================
router.post('/confirm', authenticateToken, async (req, res) => {
    const { draft } = req.body;
    if (!draft || !draft.type) {
        return res.status(400).json({ error: 'Action invalide.' });
    }
    try {
        const result = await confirmAction(draft, req.user.id);
        res.json({ success: true, result });
    } catch (err) {
        console.error('Erreur confirm:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/assistant/preferences — Lire les préférences
// ============================================================
router.get('/preferences', authenticateToken, async (req, res) => {
    try {
        const { getUserPreferences } = require('../utils/assistant/preferences');
        const prefs = await getUserPreferences(req.user.id);
        res.json(prefs);
    } catch (err) {
        console.error('Erreur get preferences:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/assistant/preferences — Modifier les préférences
// ============================================================
router.post('/preferences', authenticateToken, async (req, res) => {
    try {
        const { updateUserPreferences } = require('../utils/assistant/preferences');
        const updates = req.body || {};
        const success = await updateUserPreferences(req.user.id, updates);
        if (!success) {
            return res.status(400).json({ error: 'Aucune mise à jour valide.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur update preferences:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/assistant/suggestions — Suggestions d'apprentissage
// ============================================================
router.get('/suggestions', authenticateToken, async (req, res) => {
    try {
        const { getPendingSuggestions } = require('../utils/assistant/observations');
        const suggestions = await getPendingSuggestions(req.user.id);
        res.json(suggestions);
    } catch (err) {
        console.error('Erreur get suggestions:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/assistant/suggestions/:id/accept — Accepter une suggestion
// ============================================================
router.post('/suggestions/:id/accept', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const { acceptSuggestion } = require('../utils/assistant/observations');
        const result = await acceptSuggestion(req.user.id, id);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Erreur accept suggestion:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/assistant/suggestions/:id/dismiss — Refuser une suggestion
// ============================================================
router.post('/suggestions/:id/dismiss', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const { dismissSuggestion } = require('../utils/assistant/observations');
        await dismissSuggestion(req.user.id, id);
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur dismiss suggestion:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/assistant/suggestions/:id/mark-suggested — Marquer comme affichée
// ============================================================
router.post('/suggestions/:id/mark-suggested', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const { markSuggestionAsSuggested } = require('../utils/assistant/observations');
        await markSuggestionAsSuggested(req.user.id, id);
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur mark suggestion:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;