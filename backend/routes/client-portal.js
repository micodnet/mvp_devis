// backend/routes/client-portal.js
// Routes du portail client (cote proprietaire + cote client)

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requireClientAuth } = require('../middleware/client-auth');
const {
    createOrRefreshInvitation,
    verifyInvitationToken,
    acceptInvitation,
    loginClient,
    generateClientJwt,
    getClientDocuments,
    getCompanyInfo,
    getClientInfo,
    updateClientInfo,
    logClientAction,
    revokeClientAccount
} = require('../utils/client-portal/helpers');
const { Resend } = require('resend');

const router = express.Router();

// ============================================================
// PARTIE PROPRIETAIRE (utilise authenticateToken)
// ============================================================

// ------------------------------------------------------------
// POST /api/client-portal/invite/:clientId — Inviter un client
// ------------------------------------------------------------
router.post('/invite/:clientId', authenticateToken, async (req, res) => {
    const clientId = parseInt(req.params.clientId);
    if (!clientId) return res.status(400).json({ error: 'ID invalide.' });

    const { email } = req.body;

    try {
        // Charger le client pour recuperer son email si non fourni
        const clientResult = await pool.query(
            'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
            [clientId, req.user.id]
        );

        if (clientResult.rows.length === 0) {
            return res.status(404).json({ error: 'Client introuvable.' });
        }

        const client = clientResult.rows[0];
        const finalEmail = email || client.email;

        if (!finalEmail) {
            return res.status(400).json({ error: 'Aucun email. Precisez-en un.' });
        }

        // Creer le compte + token
        const invitation = await createOrRefreshInvitation(req.user.id, clientId, finalEmail);

        // Charger les settings pour l'email
        const settingsResult = await pool.query(
            'SELECT company_name, email FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const company = settingsResult.rows[0] || {};

        const baseUrl = (process.env.APP_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
        const invitationUrl = baseUrl + '/client.html?invite=' + invitation.token;

        // Envoyer l'email
        if (process.env.RESEND_API_KEY) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const companyName = company.company_name || 'Notre entreprise';

            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || (companyName + ' <noreply@votreentreprise.com>'),
                to: [finalEmail],
                subject: 'Votre espace client chez ' + companyName,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
                        <h1 style="color:#0b1120;font-size:22px;margin-bottom:16px;">Votre espace client</h1>
                        <p style="font-size:15px;line-height:1.6;color:#334155;">Bonjour ${client.name || ''},</p>
                        <p style="font-size:15px;line-height:1.6;color:#334155;">
                            <strong>${companyName}</strong> vous invite a acceder a votre espace client personnel.
                            Vous pourrez y consulter tous vos devis, vos factures et le suivi de vos chantiers.
                        </p>
                        <p style="text-align:center;margin:32px 0;">
                            <a href="${invitationUrl}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Creer mon compte</a>
                        </p>
                        <p style="font-size:13px;color:#64748b;line-height:1.6;">
                            Ce lien est valable 72 heures. Apres ce delai, demandez une nouvelle invitation.
                        </p>
                        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                        <p style="font-size:12px;color:#94a3b8;">
                            Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>
                            <span style="word-break:break-all;color:#f97316;">${invitationUrl}</span>
                        </p>
                    </div>
                `
            });
        } else {
            console.warn('RESEND_API_KEY absente — email non envoye. Lien:', invitationUrl);
        }

        res.json({
            success: true,
            invitationUrl,
            expiresAt: invitation.expiresAt
        });
    } catch (err) {
        console.error('Erreur invite client:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/client-portal/accounts — Liste des comptes clients
// ------------------------------------------------------------
router.get('/accounts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ca.*, c.name as client_name,
                (SELECT COUNT(*) FROM client_account_logs cal WHERE cal.client_account_id = ca.id AND cal.action = 'login') as login_count
            FROM client_accounts ca
            JOIN clients c ON c.id = ca.client_id
            WHERE ca.user_id = $1
            ORDER BY ca.created_at DESC
        `, [req.user.id]);

        res.json(result.rows.map(a => ({
            id: a.id,
            clientId: a.client_id,
            clientName: a.client_name,
            email: a.email,
            active: a.active,
            hasPassword: !!a.password_hash,
            invitationSentAt: a.invitation_sent_at,
            invitationAcceptedAt: a.invitation_accepted_at,
            lastLoginAt: a.last_login_at,
            loginCount: parseInt(a.login_count) || 0,
            createdAt: a.created_at
        })));
    } catch (err) {
        console.error('Erreur list client accounts:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/client-portal/accounts/:clientId/revoke — Revoquer
// ------------------------------------------------------------
router.post('/accounts/:clientId/revoke', authenticateToken, async (req, res) => {
    const clientId = parseInt(req.params.clientId);
    if (!clientId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const ok = await revokeClientAccount(req.user.id, clientId);
        if (!ok) {
            return res.status(404).json({ error: 'Compte client introuvable.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Erreur revoke client account:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/client-portal/accounts/:clientId/reactivate — Reactiver
// ------------------------------------------------------------
router.post('/accounts/:clientId/reactivate', authenticateToken, async (req, res) => {
    const clientId = parseInt(req.params.clientId);
    if (!clientId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE client_accounts
            SET active = TRUE, updated_at = NOW()
            WHERE user_id = $1 AND client_id = $2
            RETURNING id
        `, [req.user.id, clientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Compte client introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur reactivate client account:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PARTIE PUBLIQUE (pas d'authentification)
// ============================================================

// ------------------------------------------------------------
// GET /api/client-portal/invitation/:token — Verifier un token
// ------------------------------------------------------------
router.get('/invitation/:token', async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 32) {
        return res.status(400).json({ error: 'Token invalide.' });
    }

    try {
        const invitation = await verifyInvitationToken(token);

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation invalide ou expiree.' });
        }

        res.json({
            valid: true,
            email: invitation.email,
            clientName: invitation.clientName,
            companyName: invitation.companyName,
            companyLogo: invitation.companyLogo
        });
    } catch (err) {
        console.error('Erreur verify invitation:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/client-portal/invitation/:token/accept — Accepter
// ------------------------------------------------------------
router.post('/invitation/:token/accept', async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!token) return res.status(400).json({ error: 'Token requis.' });
    if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Mot de passe trop court (6 caracteres minimum).' });
    }

    try {
        const invitation = await acceptInvitation(token, password);

        // Logger
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        await logClientAction(invitation.accountId, invitation.userId, 'invitation_accepted_finalized', ip, req.headers['user-agent'], {});

        // Creer le JWT
        const accountResult = await pool.query(
            'SELECT * FROM client_accounts WHERE id = $1',
            [invitation.accountId]
        );
        const jwt = generateClientJwt(accountResult.rows[0]);

        res.json({
            success: true,
            token: jwt,
            user: {
                email: invitation.email,
                clientName: invitation.clientName,
                companyName: invitation.companyName
            }
        });
    } catch (err) {
        console.error('Erreur accept invitation:', err);
        res.status(400).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/client-portal/login — Connexion client
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const account = await loginClient(email, password);
        const jwt = generateClientJwt(account);

        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        await logClientAction(account.id, account.user_id, 'login_finalized', ip, req.headers['user-agent'], {});

        // Charger les infos entreprise pour affichage
        const company = await getCompanyInfo(account.user_id);

        res.json({
            success: true,
            token: jwt,
            user: {
                email: account.email,
                clientName: account.client_name,
                clientId: account.client_id,
                companyName: company.companyName
            }
        });
    } catch (err) {
        console.error('Erreur login client:', err);
        res.status(401).json({ error: err.message });
    }
});

// ============================================================
// PARTIE CLIENT CONNECTE (utilise requireClientAuth)
// ============================================================

// ------------------------------------------------------------
// GET /api/client-portal/me — Infos du client connecte
// ------------------------------------------------------------
router.get('/me', requireClientAuth, async (req, res) => {
    try {
        const client = await getClientInfo(req.clientUser.ownerId, req.clientUser.clientId);
        const company = await getCompanyInfo(req.clientUser.ownerId);

        res.json({
            client,
            company
        });
    } catch (err) {
        console.error('Erreur get me:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/client-portal/documents — Devis + factures + chantiers
// ------------------------------------------------------------
router.get('/documents', requireClientAuth, async (req, res) => {
    try {
        const client = await getClientInfo(req.clientUser.ownerId, req.clientUser.clientId);
        const documents = await getClientDocuments(
            req.clientUser.ownerId,
            req.clientUser.clientId,
            client?.email || req.clientUser.email
        );

        res.json(documents);
    } catch (err) {
        console.error('Erreur get documents:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/client-portal/update-info — Mettre a jour ses coordonnees
// ------------------------------------------------------------
router.post('/update-info', requireClientAuth, async (req, res) => {
    const { contactName, email, phone, address, vatNumber } = req.body;

    try {
        const ok = await updateClientInfo(req.clientUser.ownerId, req.clientUser.clientId, {
            contactName,
            email,
            phone,
            address,
            vatNumber
        });

        if (!ok) {
            return res.status(400).json({ error: 'Aucune modification.' });
        }

        await logClientAction(req.clientUser.id, req.clientUser.ownerId, 'info_updated', null, null, {});

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur update info:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/client-portal/documents/quotes/:id/pdf — PDF devis
// ------------------------------------------------------------
router.get('/documents/quotes/:id/pdf', requireClientAuth, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const { generateQuotePDF } = require('../utils/pdf-generator');

        // Verifier que ce devis appartient bien a ce client
        const client = await getClientInfo(req.clientUser.ownerId, req.clientUser.clientId);
        const result = await pool.query(`
            SELECT * FROM quotes
            WHERE id = $1 AND user_id = $2
              AND (client_id = $3 OR (client_email IS NOT NULL AND LOWER(client_email) = LOWER($4)))
        `, [quoteId, req.clientUser.ownerId, req.clientUser.clientId, client?.email || req.clientUser.email || '']);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const q = result.rows[0];

        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.clientUser.ownerId]
        );
        const s = settingsResult.rows[0] || {};

        const company = {
            companyName: s.company_name,
            address: s.address,
            siret: s.siret,
            tva: s.tva,
            phone: s.phone,
            email: s.email,
            website: s.website,
            logo: s.logo,
            vatRegime: s.vat_regime,
            vatRate: parseFloat(s.vat_rate) || 21
        };

        const clientObj = {
            name: q.client_name,
            address: q.client_address,
            vat: q.client_vat,
            email: q.client_email
        };

        const signature = q.signature_signed_at ? {
            method: q.signature_method,
            data: q.signature_data,
            signedAt: q.signature_signed_at,
            signedBy: q.signature_signed_by,
            ip: q.signature_ip
        } : null;

        const pdfBytes = await generateQuotePDF(
            q.items,
            parseFloat(q.subtotal) || 0,
            parseFloat(q.vat_amount) || 0,
            parseFloat(q.total),
            q.vat_regime,
            parseFloat(s.vat_rate) || 21,
            q.quote_number,
            q.issue_date,
            q.valid_date,
            company,
            clientObj,
            signature,
            s.language || 'fr',
            s.pdf_template || 'classic',
            q.signature_verification_token || null,
            q.is_multi_option === true,
            q.variants || [],
            q.selected_variant_index
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=devis_' + q.quote_number + '.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Erreur client pdf:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/client-portal/documents/invoices/:id/pdf — PDF facture
// ------------------------------------------------------------
router.get('/documents/invoices/:id/pdf', requireClientAuth, async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const client = await getClientInfo(req.clientUser.ownerId, req.clientUser.clientId);
        const result = await pool.query(`
            SELECT * FROM invoices
            WHERE id = $1 AND user_id = $2
              AND (client_id = $3 OR (client_email IS NOT NULL AND LOWER(client_email) = LOWER($4)))
        `, [invoiceId, req.clientUser.ownerId, req.clientUser.clientId, client?.email || req.clientUser.email || '']);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        // Rediriger vers la route PDF existante (pas d'auth client necessaire si on a un token public)
        // Pour l'instant, on renvoie juste un message. Le PDF de facture sera ajoute plus tard.
        res.status(501).json({ error: 'PDF facture a venir.' });
    } catch (err) {
        console.error('Erreur client invoice pdf:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;