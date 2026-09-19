// Gestion de l'équipe : invitation, liste, rôles, suppression

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Limites de membres par plan (owner inclus)
const PLAN_SEATS = {
    free: 1,
    starter: 1,
    pro: 3,
    entreprise: 10
};

const VALID_ROLES = ['owner', 'admin', 'member'];

// ============================================================
// GET /api/team/members — Liste des membres du compte
// ============================================================
router.get('/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, role, created_at
            FROM users
            WHERE account_id = $1
            ORDER BY 
                CASE role 
                    WHEN 'owner' THEN 1 
                    WHEN 'admin' THEN 2 
                    WHEN 'member' THEN 3 
                    ELSE 4
                END,
                created_at ASC
        `, [req.user.id]);

        res.json({
            members: result.rows.map(u => ({
                id: u.id,
                email: u.email,
                role: u.role || 'member',
                createdAt: u.created_at,
                isMe: u.id === req.user.userId
            })),
            myRole: req.user.role,
            seatsUsed: result.rows.length
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/team/invitations — Invitations en attente
// ============================================================
router.get('/invitations', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, role, expires_at, created_at
            FROM team_invitations
            WHERE account_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
            ORDER BY created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(i => ({
            id: i.id,
            email: i.email,
            role: i.role,
            expiresAt: i.expires_at,
            createdAt: i.created_at
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/team/invite — Inviter un nouveau membre
// ============================================================
router.post('/invite', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
    const { email, role } = req.body;

    if (!email || !email.trim()) return res.status(400).json({ error: 'Email requis.' });
    if (!VALID_ROLES.includes(role) || role === 'owner') {
        return res.status(400).json({ error: 'Rôle invalide.' });
    }

    const emailLower = email.trim().toLowerCase();

    try {
        // 1. Vérifier que l'utilisateur n'existe pas déjà
        const existingUser = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [emailLower]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        // 2. Vérifier qu'il n'y a pas déjà une invitation en attente
        const existingInvite = await pool.query(`
            SELECT id FROM team_invitations
            WHERE account_id = $1 AND LOWER(email) = $2 AND accepted_at IS NULL AND expires_at > NOW()
        `, [req.user.id, emailLower]);
        if (existingInvite.rows.length > 0) {
            return res.status(409).json({ error: 'Une invitation est déjà en attente pour cet email.' });
        }

        // 3. Vérifier la limite de sièges du plan
        const planResult = await pool.query(
            'SELECT subscription_plan FROM users WHERE id = $1',
            [req.user.id]
        );
        const plan = planResult.rows[0]?.subscription_plan || 'free';
        const seatsLimit = PLAN_SEATS[plan] ?? 1;

        const membersCount = await pool.query('SELECT COUNT(*) FROM users WHERE account_id = $1', [req.user.id]);
        const invitesCount = await pool.query(
            'SELECT COUNT(*) FROM team_invitations WHERE account_id = $1 AND accepted_at IS NULL AND expires_at > NOW()',
            [req.user.id]
        );
        const usedSeats = parseInt(membersCount.rows[0].count) + parseInt(invitesCount.rows[0].count);

        if (usedSeats >= seatsLimit) {
            return res.status(400).json({
                error: `Votre plan ${plan} autorise ${seatsLimit} membre(s). Passez à un plan supérieur pour en inviter plus.`
            });
        }
        
        // 4. Créer l'invitation
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours

        await pool.query(`
            INSERT INTO team_invitations (account_id, email, role, token, invited_by, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.user.id, emailLower, role, token, req.user.userId, expiresAt]);

        // 5. Récupérer le nom de l'entreprise pour l'email
        const settingsResult = await pool.query(
            'SELECT company_name FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const companyName = settingsResult.rows[0]?.company_name || 'Devis Express Pro';

        // 6. Envoyer l'email
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const inviteUrl = `${baseUrl}/?invite=${token}`;

        if (process.env.RESEND_API_KEY) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
                    to: [emailLower],
                    subject: `Invitation à rejoindre ${companyName} sur Devis Express Pro`,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
                            <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Vous êtes invité(e) à rejoindre ${companyName}</h1>
                            <p style="font-size:15px;line-height:1.6;color:#334155;">
                                Bonjour,
                            </p>
                            <p style="font-size:15px;line-height:1.6;color:#334155;">
                                <strong>${req.user.email}</strong> vous invite à rejoindre son espace de travail sur <strong>Devis Express Pro</strong> avec le rôle <strong>${role}</strong>.
                            </p>
                            <p style="text-align:center;margin:32px 0;">
                                <a href="${inviteUrl}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Accepter l'invitation</a>
                            </p>
                            <p style="font-size:13px;color:#64748b;line-height:1.6;">
                                Ce lien est valable 7 jours. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
                            </p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error('Erreur envoi email invitation:', emailErr);
            }
        } else {
            console.warn('RESEND_API_KEY absente — email non envoyé. Lien:', inviteUrl);
        }

        res.json({ success: true, message: 'Invitation envoyée.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/team/invitations/:id — Annuler une invitation
// ============================================================
router.delete('/invitations/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM team_invitations WHERE id = $1 AND account_id = $2 AND accepted_at IS NULL RETURNING id',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invitation introuvable.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/team/members/:id/role — Changer le rôle d'un membre
// ============================================================
router.put('/members/:id/role', authenticateToken, requireRole('owner'), async (req, res) => {
    const memberId = parseInt(req.params.id);
    const { role } = req.body;

    if (!memberId) return res.status(400).json({ error: 'ID invalide.' });
    if (!VALID_ROLES.includes(role) || role === 'owner') {
        return res.status(400).json({ error: 'Rôle invalide.' });
    }
    if (memberId === req.user.userId) {
        return res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle.' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET role = $1 WHERE id = $2 AND account_id = $3 RETURNING id, email, role',
            [role, memberId, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Membre introuvable.' });
        }
        res.json({ success: true, member: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/team/members/:id — Retirer un membre
// ============================================================
router.delete('/members/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
    const memberId = parseInt(req.params.id);

    if (!memberId) return res.status(400).json({ error: 'ID invalide.' });
    if (memberId === req.user.userId) {
        return res.status(400).json({ error: 'Vous ne pouvez pas vous retirer vous-même.' });
    }

    try {
        // Vérifier que le membre est bien dans ce compte et n'est pas l'owner
        const check = await pool.query(
            'SELECT role FROM users WHERE id = $1 AND account_id = $2',
            [memberId, req.user.id]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Membre introuvable.' });
        }
        if (check.rows[0].role === 'owner') {
            return res.status(400).json({ error: 'Impossible de retirer le propriétaire.' });
        }

        // Supprimer l'utilisateur (les données restent, elles appartiennent au compte)
        await pool.query('DELETE FROM users WHERE id = $1 AND account_id = $2', [memberId, req.user.id]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/public/invitations/:token — Infos d'une invitation (public)
// ============================================================
router.get('/public/invitations/:token', async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 32) return res.status(400).json({ error: 'Token invalide.' });

    try {
        const result = await pool.query(`
            SELECT i.email, i.role, i.expires_at, i.accepted_at,
                   s.company_name as company
            FROM team_invitations i
            LEFT JOIN settings s ON s.user_id = i.account_id
            WHERE i.token = $1
        `, [token]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Invitation introuvable.' });
        const inv = result.rows[0];
        if (inv.accepted_at) return res.status(410).json({ error: 'Cette invitation a déjà été utilisée.' });
        if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'Cette invitation a expiré.' });

        res.json({
            email: inv.email,
            role: inv.role,
            company: inv.company || 'Devis Express Pro'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/public/invitations/:token/accept — Créer le compte et rejoindre
// ============================================================
router.post('/public/invitations/:token/accept', async (req, res) => {
    const { token } = req.params;
    const { password, termsAccepted } = req.body;

    if (!token || token.length < 32) return res.status(400).json({ error: 'Token invalide.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
    if (!termsAccepted) return res.status(400).json({ error: 'Vous devez accepter les CGU.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Récupérer l'invitation
        const invResult = await client.query(`
            SELECT * FROM team_invitations WHERE token = $1
        `, [token]);
        if (invResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Invitation introuvable.' });
        }
        const inv = invResult.rows[0];
        if (inv.accepted_at) {
            await client.query('ROLLBACK');
            return res.status(410).json({ error: 'Cette invitation a déjà été utilisée.' });
        }
        if (new Date(inv.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            return res.status(410).json({ error: 'Invitation expirée.' });
        }

        // 2. Vérifier que l'email n'existe pas déjà
        const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [inv.email]);
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
        }

        // 3. Créer l'utilisateur rattaché au compte
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await client.query(`
            INSERT INTO users (email, password_hash, account_id, role, terms_accepted_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, email, account_id, role
        `, [inv.email, passwordHash, inv.account_id, inv.role]);

        const user = newUser.rows[0];

        // 4. Marquer l'invitation comme acceptée
        await client.query('UPDATE team_invitations SET accepted_at = NOW() WHERE id = $1', [inv.id]);

        await client.query('COMMIT');

        // 5. Générer le JWT
        const jwtToken = jwt.sign(
            { id: user.id, email: user.email, account_id: user.account_id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token: jwtToken,
            user: { id: user.id, email: user.email, account_id: user.account_id, role: user.role }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur accept invite:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

module.exports = router;