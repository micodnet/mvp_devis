// ------------------------------------------------------------
// Authentication routes: signup, login, forgot password, reset password
// ------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const { pool } = require('../db');

const router = express.Router();

// Helper: build the base URL of the app (works local + Render)
function getAppUrl(req) {
    const proto = req.protocol || 'http';
    const host = req.get('host');
    return `${proto}://${host}`;
}

// ------------------------------------------------------------
// POST /api/auth/signup
// ------------------------------------------------------------
router.post('/signup', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
            [email, passwordHash]
        );
        const user = result.rows[0];

        await pool.query('INSERT INTO settings (user_id) VALUES ($1)', [user.id]);
        await pool.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 0)', [user.id]);

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('Erreur signup:', err);
        res.status(500).json({ error: 'Erreur lors de l\'inscription.' });
    }
});

// ------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    try {
        const result = await pool.query(
            'SELECT id, email, password_hash FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('Erreur login:', err);
        res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
});

// ------------------------------------------------------------
// POST /api/auth/forgot-password
// ------------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    try {
        // Always return 200 to avoid leaking whether an account exists
        const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);

        if (userResult.rows.length === 0) {
            return res.json({ success: true, message: 'Si un compte existe, un email vous a été envoyé.' });
        }

        const user = userResult.rows[0];

        // Delete any previous unused tokens for this user
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE', [user.id]);

        // Generate a secure token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt]
        );

        const resetUrl = `${getAppUrl(req)}/?reset=${token}`;

        // Send email (if Resend is configured)
        if (process.env.RESEND_API_KEY) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
                    to: [user.email],
                    subject: 'Réinitialisation de votre mot de passe',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                            <h1 style="color:#0a1f3d;">Réinitialisation de votre mot de passe</h1>
                            <p>Bonjour,</p>
                            <p>Vous avez demandé la réinitialisation de votre mot de passe sur <strong>Devis Express Pro</strong>.</p>
                            <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable <strong>1 heure</strong>.</p>
                            <p style="text-align:center;margin:30px 0;">
                                <a href="${resetUrl}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;">Réinitialiser mon mot de passe</a>
                            </p>
                            <p style="color:#64748b;font-size:13px;">Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :</p>
                            <p style="color:#64748b;font-size:13px;word-break:break-all;">${resetUrl}</p>
                            <p style="color:#64748b;font-size:13px;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
                            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                            <p style="color:#94a3b8;font-size:12px;">Devis Express Pro — Générateur de devis par IA</p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error('Erreur envoi email reset:', emailErr);
                // Don't fail the request if email fails — the token is stored anyway
            }
        } else {
            console.warn('RESEND_API_KEY absente — email non envoyé. Lien:', resetUrl);
        }

        res.json({ success: true, message: 'Si un compte existe, un email vous a été envoyé.' });
    } catch (err) {
        console.error('Erreur forgot-password:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ------------------------------------------------------------
// POST /api/auth/reset-password
// ------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ error: 'Token et mot de passe requis.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    try {
        const result = await pool.query(
            'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Lien invalide ou expiré.' });
        }

        const row = result.rows[0];
        if (row.used) {
            return res.status(400).json({ error: 'Ce lien a déjà été utilisé.' });
        }
        if (new Date(row.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Lien expiré. Veuillez refaire une demande.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
        await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [row.id]);

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur reset-password:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;