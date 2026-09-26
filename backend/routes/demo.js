// backend/routes/demo.js
// Routes pour le mode demo

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../db');
const { seedDemoData } = require('../utils/demo/seed');

const router = express.Router();

const DEMO_DURATION_MINUTES = 30;

// ============================================================
// POST /api/demo/start — Creer une session demo
// ============================================================
router.post('/start', async (req, res) => {
    try {
        const demoId = crypto.randomBytes(6).toString('hex');
        const email = 'demo-' + demoId + '@devis-express.local';
        const password = crypto.randomBytes(16).toString('hex');
        const passwordHash = await bcrypt.hash(password, 10);

        const expiresAt = new Date(Date.now() + DEMO_DURATION_MINUTES * 60 * 1000);

        // Creer l'utilisateur demo
        const userResult = await pool.query(`
            INSERT INTO users (email, password_hash, is_demo, demo_expires_at, terms_accepted_at)
            VALUES ($1, $2, TRUE, $3, NOW())
            RETURNING id, email
        `, [email, passwordHash, expiresAt]);

        const userId = userResult.rows[0].id;

        // Peupler les donnees
        await seedDemoData(userId, 'Demo Construction SA');

        // Generer un token JWT
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: userId, email: email, isDemo: true },
            process.env.JWT_SECRET || 'dev-secret-change-me',
            { expiresIn: DEMO_DURATION_MINUTES + 'm' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: userId,
                email: email,
                isDemo: true
            },
            expiresAt: expiresAt.toISOString(),
            durationMinutes: DEMO_DURATION_MINUTES
        });
    } catch (err) {
        console.error('Erreur start demo:', err);
        res.status(500).json({ error: 'Impossible de demarrer la demo : ' + err.message });
    }
});

// ============================================================
// GET /api/demo/status — Verifier si la session demo est active
// ============================================================
router.get('/status', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.json({ isDemo: false });
    }

    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET || 'dev-secret-change-me');

        if (!decoded.isDemo) {
            return res.json({ isDemo: false });
        }

        const result = await pool.query(
            'SELECT demo_expires_at FROM users WHERE id = $1 AND is_demo = TRUE',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.json({ isDemo: false, expired: true });
        }

        const expiresAt = new Date(result.rows[0].demo_expires_at);
        const remainingMs = expiresAt.getTime() - Date.now();

        res.json({
            isDemo: true,
            expiresAt: expiresAt.toISOString(),
            remainingMinutes: Math.max(0, Math.floor(remainingMs / 60000)),
            expired: remainingMs <= 0
        });
    } catch (err) {
        res.json({ isDemo: false });
    }
});

// ============================================================
// POST /api/demo/cleanup — Nettoyer les comptes demo expires
// ============================================================
router.post('/cleanup', async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM users
            WHERE is_demo = TRUE AND demo_expires_at < NOW()
            RETURNING id
        `);

        res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;