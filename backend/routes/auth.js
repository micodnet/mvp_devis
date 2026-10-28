// ------------------------------------------------------------
// Authentication routes: signup, login, forgot password, reset password
// ------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const { authService } = require('../services/authService');
//import { authMiddleware } from "../middleware/auth.js";
const { asyncHandler } = require('../middleware/errorHandler');
const { validate } = require('../middleware/validate');

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
    const { email, password, termsAccepted } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
    if (!termsAccepted) {
        return res.status(400).json({ error: 'Vous devez accepter les CGU et la politique de confidentialité.' });
    }
    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Créer l'utilisateur avec account_id = son propre id (il est propriétaire)
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, terms_accepted_at, role) VALUES ($1, $2, NOW(), $3) RETURNING id, email',
            [email, passwordHash, 'owner']
        );
        const user = result.rows[0];

        // account_id = son propre id
        await pool.query('UPDATE users SET account_id = $1 WHERE id = $1', [user.id]);

        await pool.query('INSERT INTO settings (user_id) VALUES ($1)', [user.id]);
        await pool.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 0)', [user.id]);

        const token = jwt.sign(
            { id: user.id, email: user.email, account_id: user.id, role: 'owner' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Envoyer l'email de bienvenue (asynchrone, ne bloque pas la réponse)
        // ⚠ commenter pour les tests, à décommenter en prod 
        sendWelcomeEmail(req, user.email).catch(err => {
            console.error('Erreur envoi email de bienvenue:', err.message);
        });

        res.status(201).json({ token, user: { id: user.id, email: user.email, account_id: user.id, role: 'owner' } });
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
            'SELECT id, email, password_hash, account_id, role FROM users WHERE email = $1',
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

        const accountId = user.account_id || user.id;
        const role = user.role || 'owner';
        const token = jwt.sign(
            { id: user.id, email: user.email, account_id: accountId, role: role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ token, user: { id: user.id, email: user.email, account_id: accountId, role: role } });
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
                const { error } = await resend.emails.send({
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
                if (error) {
                    console.error(`❌ Erreur envoi welcome email à ${email}:`, error.message);
                    return;
                }
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

// ------------------------------------------------------------
// Envoie l'email de bienvenue à un nouvel utilisateur
// ------------------------------------------------------------
async function sendWelcomeEmail(req, email) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY absente — email de bienvenue non envoyé.');
        return;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
            to: [email],
            subject: '🎉 Bienvenue sur Devis Express Pro',
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
                    <h1 style="color:#0b1120;font-size:26px;margin-bottom:16px;">Bienvenue sur Devis Express Pro 🎉</h1>
                    <p style="font-size:15px;line-height:1.6;color:#334155;">
                        Votre compte est prêt. Vous pouvez dès maintenant générer vos premiers devis en quelques secondes grâce à l'IA.
                    </p>
                    <h2 style="color:#0b1120;font-size:18px;margin-top:28px;margin-bottom:12px;">🚀 Vos 3 premières étapes</h2>
                    <ol style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
                        <li><strong>Configurez votre entreprise</strong> — nom, adresse, numéro de TVA, logo.<br>
                            <a href="${baseUrl}/" style="color:#f97316;">Aller aux paramètres →</a></li>
                        <li><strong>Ajoutez vos produits</strong> — un par un ou via un import CSV/Excel.<br>
                            <a href="${baseUrl}/" style="color:#f97316;">Ouvrir le catalogue →</a></li>
                        <li><strong>Générez votre premier devis</strong> — déposez une demande client, l'IA fait le reste.<br>
                            <a href="${baseUrl}/" style="color:#f97316;">Générer un devis →</a></li>
                    </ol>
                    <div style="background:#f1f5f9;border-left:4px solid #f97316;padding:14px 18px;border-radius:8px;margin-top:24px;font-size:14px;color:#334155;">
                        <strong>💡 Astuce :</strong> commencez par ajouter un client dans votre carnet pour ne plus avoir à retaper ses coordonnées à chaque devis.
                    </div>
                    <p style="text-align:center;margin-top:32px;">
                        <a href="${baseUrl}/" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Accéder à mon compte</a>
                    </p>
                    <p style="color:#94a3b8;font-size:12px;margin-top:32px;text-align:center;">
                        Vous recevez cet email car vous venez de créer un compte sur Devis Express Pro.<br>
                        Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.
                    </p>
                </div>
            `
        });
        if (error) {
            console.error(`❌ Erreur envoi welcome email à ${email}:`, error.message);
            return;
        }
        console.log(`📧 Email de bienvenue envoyé à ${email}`);
    } catch (err) {
        console.error('Erreur envoi welcome email:', err.message);
    }
}

// ------------------------------------------------------------
// POST /api/auth/change-password
// Change le mot de passe d'un utilisateur connecté
// ------------------------------------------------------------
router.post('/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
    }
    if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'actuel.' });
    }

    try {
        // Récupérer l'utilisateur RÉEL (pas le compte partagé)
        const result = await pool.query(
            'SELECT id, password_hash FROM users WHERE id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
        }

        // Hasher et enregistrer le nouveau
        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newHash, user.id]
        );

        res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
    } catch (err) {
        console.error('Erreur change-password:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});



router.post(
  "/auth/register",
  validate({ body: { email: "string!", password: "string!", name: "string!" } }),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  })
);

router.post(
  "/auth/login",
  validate({ body: { email: "string!", password: "string!" } }),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json(result);
  })
);

router.get(
  "/auth/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const me = await authService.me(req.user.id);
    res.json(me);
  })
);

module.exports = router;