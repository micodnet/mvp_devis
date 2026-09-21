// backend/routes/assistant.js
// Route de l'assistant conversationnel

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { chat } = require('../utils/assistant/orchestrator');

const router = express.Router();

// ============================================================
// POST /api/assistant/chat — Envoyer un message à l'assistant
// ============================================================
router.post('/chat', authenticateToken, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'Message trop long (2000 caractères max).' });
    }

    try {
        const result = await chat(message.trim(), req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Erreur assistant:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

module.exports = router;