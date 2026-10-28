// backend/routes/assistant-v2.js
// Route de l'assistant V2 (multi-agent).
// Coexiste avec la V1 (/api/assistant/*).

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const orchestrator = require('../utils/assistant_v2/core/orchestrator');
const trainingCollector = require('../utils/assistant_v2/llm/training-collector');
const intentLearner = require('../utils/assistant_v2/llm/intent-learner');
const longTerm = require('../utils/assistant_v2/memory/long-term');

const router = express.Router();

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/chat — Envoyer un message
// ═══════════════════════════════════════════════════════════
router.post('/chat', authenticateToken, async (req, res) => {
    const { message, history } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'Message trop long (2000 caractères max).' });
    }

    // Nettoyer l'historique
    let conversationHistory = [];
    if (Array.isArray(history)) {
        conversationHistory = history
            .filter(m => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
            .slice(-10)
            .map(m => ({ role: m.role, text: m.text.slice(0, 500) }));
    }

    try {
        const result = await orchestrator.chat(message.trim(), req.user.id, conversationHistory);

        // Collecter pour fine-tuning (async, non-bloquant)
        trainingCollector.collect({
            userId: req.user.id,
            userMessage: message.trim(),
            response: result,
            conversationHistory,
        }).catch(() => { /* silent */ });

        res.json(result);
    } catch (err) {
        console.error('❌ [V2/chat] Erreur:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/confirm — Confirmer une action
// ═══════════════════════════════════════════════════════════
router.post('/confirm', authenticateToken, async (req, res) => {
    const { draft } = req.body;
    if (!draft || !draft.type) {
        return res.status(400).json({ error: 'Action invalide.' });
    }
    try {
        const result = await orchestrator.confirmAction(draft, req.user.id);

        // Collecter la confirmation réussie (feedback positif)
        trainingCollector.collectConfirmation({
            userId: req.user.id,
            draft,
            result,
        }).catch(() => { /* silent */ });

        res.json({ success: true, result });
    } catch (err) {
        console.error('❌ [V2/confirm] Erreur:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/feedback — Feedback utilisateur
// ═══════════════════════════════════════════════════════════
router.post('/feedback', authenticateToken, async (req, res) => {
    const { messageId, rating, correction } = req.body;
    try {
        await trainingCollector.recordFeedback({
            userId: req.user.id,
            messageId,
            rating,
            correction,
        });
        res.json({ success: true });
    } catch (err) {
        console.error('❌ [V2/feedback] Erreur:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/assistant/v2/health — Diagnostic
// ═══════════════════════════════════════════════════════════
router.get('/health', authenticateToken, async (req, res) => {
    const llm = require('../utils/assistant_v2/llm/client');
    try {
        const health = await llm.healthCheck();
        res.json({
            status: 'ok',
            llm: health,
            version: '2.0.0',
            features: ['planner', 'executor', 'critic', 'memory', 'learning'],
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/learn — Déclencher l'apprentissage
// ═══════════════════════════════════════════════════════════
router.post('/learn', authenticateToken, async (req, res) => {
    try {
        const result = await intentLearner.analyzeHistory(req.user.id);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('❌ [V2/learn] Erreur:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/assistant/v2/learnings — Voir les patterns détectés
// ═══════════════════════════════════════════════════════════
router.get('/learnings', authenticateToken, async (req, res) => {
    try {
        const result = await intentLearner.getPendingLearnings(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('❌ [V2/learnings] Erreur:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/learnings/:id/apply — Appliquer un pattern
// ═══════════════════════════════════════════════════════════
router.post('/learnings/:id/apply', authenticateToken, async (req, res) => {
    try {
        const result = await intentLearner.applyLearning(req.user.id, parseInt(req.params.id));
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('❌ [V2/learnings/apply] Erreur:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/assistant/v2/learnings/:id/dismiss — Rejeter
// ═══════════════════════════════════════════════════════════
router.post('/learnings/:id/dismiss', authenticateToken, async (req, res) => {
    try {
        await intentLearner.dismissLearning(req.user.id, parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        console.error('❌ [V2/learnings/dismiss] Erreur:', err);
        res.status(500).json({ error: err.message });
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