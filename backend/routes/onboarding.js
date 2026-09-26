// backend/routes/onboarding.js
// Suivi de la progression d'onboarding

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const STEPS = [
    {
        key: 'company',
        title: 'Configurer votre entreprise',
        description: 'Nom, adresse, numero de TVA, logo',
        tab: 'tab-settings',
        action: 'Remplir les informations de votre entreprise dans les parametres.'
    },
    {
        key: 'first_client',
        title: 'Creer votre premier client',
        description: 'Pour ne plus retaper ses coordonnees a chaque devis',
        tab: 'tab-clients',
        action: 'Ajoutez un client depuis l\'onglet Clients.'
    },
    {
        key: 'first_quote',
        title: 'Generer votre premier devis',
        description: 'Deposez un fichier client et l\'IA fait le reste',
        tab: 'tab-devis',
        action: 'Glissez un PDF, Word ou Excel dans l\'onglet Devis.'
    },
    {
        key: 'signature',
        title: 'Faire signer un devis',
        description: 'Envoyez le lien au client, il signe en ligne',
        tab: 'tab-history',
        action: 'Envoyez un devis au client depuis l\'historique.'
    },
    {
        key: 'assistant',
        title: 'Decouvrir l\'assistant IA',
        description: 'Dictez un chantier, l\'IA cree le devis',
        tab: 'tab-assistant',
        action: 'Posez une question ou dictez un chantier a l\'assistant.'
    }
];

// ============================================================
// GET /api/onboarding — Progression actuelle
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM onboarding_progress WHERE user_id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            await pool.query(
                'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
                [req.user.id]
            );
            return res.json({
                completedSteps: [],
                tourCompleted: false,
                welcomeSeen: false,
                checklistDismissed: false,
                totalSteps: STEPS.length,
                progress: 0,
                steps: STEPS
            });
        }

        const row = result.rows[0];
        const completed = row.completed_steps || [];

        res.json({
            completedSteps: completed,
            tourCompleted: row.tour_completed,
            welcomeSeen: row.welcome_seen,
            checklistDismissed: row.checklist_dismissed,
            totalSteps: STEPS.length,
            progress: Math.round((completed.length / STEPS.length) * 100),
            steps: STEPS
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/step — Marquer une etape faite
// ============================================================
router.post('/step', authenticateToken, async (req, res) => {
    const { step } = req.body;

    if (!step || !STEPS.find(s => s.key === step)) {
        return res.status(400).json({ error: 'Etape inconnue.' });
    }

    try {
        await pool.query(
            'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        const result = await pool.query(
            'SELECT completed_steps FROM onboarding_progress WHERE user_id = $1',
            [req.user.id]
        );

        const current = result.rows[0].completed_steps || [];
        if (!current.includes(step)) {
            current.push(step);
        }

        await pool.query(`
            UPDATE onboarding_progress
            SET completed_steps = $1, last_step_at = NOW(), updated_at = NOW()
            WHERE user_id = $2
        `, [JSON.stringify(current), req.user.id]);

        res.json({ success: true, completedSteps: current });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/tour-completed — Marquer la visite terminee
// ============================================================
router.post('/tour-completed', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        await pool.query(
            'UPDATE onboarding_progress SET tour_completed = TRUE, updated_at = NOW() WHERE user_id = $1',
            [req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/welcome-seen — Marquer le message d'accueil vu
// ============================================================
router.post('/welcome-seen', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        await pool.query(
            'UPDATE onboarding_progress SET welcome_seen = TRUE, updated_at = NOW() WHERE user_id = $1',
            [req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/dismiss-checklist — Masquer la checklist
// ============================================================
router.post('/dismiss-checklist', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        await pool.query(
            'UPDATE onboarding_progress SET checklist_dismissed = TRUE, updated_at = NOW() WHERE user_id = $1',
            [req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/reset — Reinitialiser l'onboarding
// ============================================================
router.post('/reset', authenticateToken, async (req, res) => {
    try {
        await pool.query(`
            UPDATE onboarding_progress
            SET completed_steps = '[]'::jsonb,
                tour_completed = FALSE,
                welcome_seen = FALSE,
                checklist_dismissed = FALSE,
                updated_at = NOW()
            WHERE user_id = $1
        `, [req.user.id]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/onboarding/auto-detect — Detecte automatiquement les etapes
// ============================================================
router.post('/auto-detect', authenticateToken, async (req, res) => {
    try {
        const detected = [];

        // Etape company : nom d'entreprise renseigne
        const settingsResult = await pool.query(
            'SELECT company_name FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        if (settingsResult.rows.length > 0) {
            const name = (settingsResult.rows[0].company_name || '').trim();
            if (name && name !== 'Votre Entreprise') {
                detected.push('company');
            }
        }

        // Etape first_client
        const clientsResult = await pool.query(
            'SELECT COUNT(*) as count FROM clients WHERE user_id = $1',
            [req.user.id]
        );
        if (parseInt(clientsResult.rows[0].count) > 0) {
            detected.push('first_client');
        }

        // Etape first_quote
        const quotesResult = await pool.query(
            'SELECT COUNT(*) as count FROM quotes WHERE user_id = $1',
            [req.user.id]
        );
        if (parseInt(quotesResult.rows[0].count) > 0) {
            detected.push('first_quote');
        }

        // Etape signature : au moins un devis signe
        const signedResult = await pool.query(
            'SELECT COUNT(*) as count FROM quotes WHERE user_id = $1 AND signature_signed_at IS NOT NULL',
            [req.user.id]
        );
        if (parseInt(signedResult.rows[0].count) > 0) {
            detected.push('signature');
        }

        // Fusionner avec les etapes deja faites
        await pool.query(
            'INSERT INTO onboarding_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        const currentResult = await pool.query(
            'SELECT completed_steps FROM onboarding_progress WHERE user_id = $1',
            [req.user.id]
        );

        const current = currentResult.rows[0].completed_steps || [];
        const merged = Array.from(new Set([...current, ...detected]));

        if (merged.length !== current.length) {
            await pool.query(`
                UPDATE onboarding_progress
                SET completed_steps = $1, updated_at = NOW()
                WHERE user_id = $2
            `, [JSON.stringify(merged), req.user.id]);
        }

        res.json({ success: true, completedSteps: merged, newlyDetected: detected });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;