// backend/utils/client-portal/helpers.js
// Logique metier du portail client

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const INVITATION_LIFETIME_HOURS = 72; // 3 jours
const SESSION_LIFETIME_DAYS = 30;

// ------------------------------------------------------------
// Genere un token d'invitation unique
// ------------------------------------------------------------
function generateInvitationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ------------------------------------------------------------
// Genere un JWT pour un client connecte
// ------------------------------------------------------------
function generateClientJwt(clientAccount) {
    return jwt.sign(
        {
            id: clientAccount.id,
            clientId: clientAccount.client_id,
            ownerId: clientAccount.user_id,
            email: clientAccount.email,
            type: 'client_account'
        },
        JWT_SECRET,
        { expiresIn: SESSION_LIFETIME_DAYS + 'd' }
    );
}

// ------------------------------------------------------------
// Cree ou met a jour un compte client, et renvoie le token d'invitation
// ------------------------------------------------------------
async function createOrRefreshInvitation(userId, clientId, email) {
    if (!email) throw new Error('Email requis.');

    // Verifier que le client appartient a l'utilisateur
    const clientResult = await pool.query(
        'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
        [clientId, userId]
    );

    if (clientResult.rows.length === 0) {
        throw new Error('Client introuvable.');
    }

    const client = clientResult.rows[0];

    // Verifier si un compte existe deja
    const existingResult = await pool.query(
        'SELECT * FROM client_accounts WHERE user_id = $1 AND client_id = $2',
        [userId, clientId]
    );

    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_HOURS * 60 * 60 * 1000);

    let accountId;

    if (existingResult.rows.length > 0) {
        // Compte existe : mettre a jour le token
        const account = existingResult.rows[0];

        await pool.query(`
            UPDATE client_accounts
            SET invitation_token = $1,
                invitation_expires_at = $2,
                invitation_sent_at = NOW(),
                email = $3,
                updated_at = NOW()
            WHERE id = $4
        `, [token, expiresAt, email, account.id]);

        accountId = account.id;
    } else {
        // Creer un nouveau compte
        const insertResult = await pool.query(`
            INSERT INTO client_accounts (
                user_id, client_id, email,
                invitation_token, invitation_expires_at, invitation_sent_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id
        `, [userId, clientId, email, token, expiresAt]);

        accountId = insertResult.rows[0].id;
    }

    // Log
    await logClientAction(accountId, userId, 'invitation_created', null, null, { email });

    return {
        accountId,
        token,
        expiresAt,
        clientName: client.name
    };
}

// ------------------------------------------------------------
// Verifie un token d'invitation
// ------------------------------------------------------------
async function verifyInvitationToken(token) {
    if (!token) return null;

    const result = await pool.query(`
        SELECT ca.*, c.name as client_name, c.email as client_email,
               s.company_name as company_name, s.logo as company_logo
        FROM client_accounts ca
        JOIN clients c ON c.id = ca.client_id
        LEFT JOIN settings s ON s.user_id = ca.user_id
        WHERE ca.invitation_token = $1
    `, [token]);

    if (result.rows.length === 0) return null;

    const account = result.rows[0];

    if (new Date(account.invitation_expires_at) < new Date()) {
        return null;
    }

    if (account.invitation_accepted_at) {
        return null;
    }

    return {
        accountId: account.id,
        email: account.email,
        clientId: account.client_id,
        clientName: account.client_name,
        userId: account.user_id,
        companyName: account.company_name,
        companyLogo: account.company_logo
    };
}

// ------------------------------------------------------------
// Accepte une invitation et definit le mot de passe
// ------------------------------------------------------------
async function acceptInvitation(token, password) {
    const invitation = await verifyInvitationToken(token);
    if (!invitation) {
        throw new Error('Invitation invalide ou expiree.');
    }

    if (!password || password.length < 6) {
        throw new Error('Mot de passe trop court (6 caracteres minimum).');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(`
        UPDATE client_accounts
        SET password_hash = $1,
            invitation_accepted_at = NOW(),
            invitation_token = NULL,
            updated_at = NOW()
        WHERE id = $2
    `, [passwordHash, invitation.accountId]);

    await logClientAction(invitation.accountId, invitation.userId, 'invitation_accepted', null, null, {});

    return invitation;
}

// ------------------------------------------------------------
// Verifie un email + mot de passe
// ------------------------------------------------------------
async function loginClient(email, password) {
    if (!email || !password) {
        throw new Error('Email et mot de passe requis.');
    }

    const result = await pool.query(`
        SELECT ca.*, c.name as client_name
        FROM client_accounts ca
        JOIN clients c ON c.id = ca.client_id
        WHERE LOWER(ca.email) = LOWER($1)
          AND ca.password_hash IS NOT NULL
          AND ca.active = TRUE
    `, [email]);

    if (result.rows.length === 0) {
        throw new Error('Email ou mot de passe incorrect.');
    }

    const account = result.rows[0];

    const validPassword = await bcrypt.compare(password, account.password_hash);
    if (!validPassword) {
        throw new Error('Email ou mot de passe incorrect.');
    }

    // Mettre a jour last_login_at
    await pool.query(
        'UPDATE client_accounts SET last_login_at = NOW() WHERE id = $1',
        [account.id]
    );

    await logClientAction(account.id, account.user_id, 'login', null, null, {});

    return account;
}

// ------------------------------------------------------------
// Verifie un JWT client
// ------------------------------------------------------------
function verifyClientJwt(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'client_account') return null;
        return decoded;
    } catch (e) {
        return null;
    }
}

// ------------------------------------------------------------
// Charge les documents du client (devis, factures, chantiers)
// ------------------------------------------------------------
async function getClientDocuments(userId, clientId, clientEmail) {
    // Devis : match par clientId OU par email
    const quotesResult = await pool.query(`
        SELECT id, quote_number, issue_date, valid_date, total, currency, status,
               signature_signed_at, signature_signed_by, public_token,
               is_multi_option, selected_variant_index
        FROM quotes
        WHERE user_id = $1
          AND (client_id = $2 OR (client_email IS NOT NULL AND LOWER(client_email) = LOWER($3)))
        ORDER BY issue_date DESC
        LIMIT 200
    `, [userId, clientId, clientEmail || '']);

    // Factures
    const invoicesResult = await pool.query(`
        SELECT id, invoice_number, invoice_type, issue_date, due_date,
               total, amount_paid, amount_due, currency, status
        FROM invoices
        WHERE user_id = $1
          AND (client_id = $2 OR (client_email IS NOT NULL AND LOWER(client_email) = LOWER($3)))
        ORDER BY issue_date DESC
        LIMIT 200
    `, [userId, clientId, clientEmail || '']);

    // Chantiers
    const chantiersResult = await pool.query(`
        SELECT id, name, reference, status, start_date, end_date,
               budget_estimate, color, updated_at
        FROM chantiers
        WHERE user_id = $1 AND client_id = $2
        ORDER BY updated_at DESC
        LIMIT 100
    `, [userId, clientId]);

    return {
        quotes: quotesResult.rows.map(q => ({
            id: q.id,
            number: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            total: parseFloat(q.total),
            currency: q.currency || 'EUR',
            status: q.status,
            signedAt: q.signature_signed_at,
            signedBy: q.signature_signed_by,
            publicToken: q.public_token,
            isMultiOption: q.is_multi_option || false,
            selectedVariantIndex: q.selected_variant_index
        })),
        invoices: invoicesResult.rows.map(i => ({
            id: i.id,
            number: i.invoice_number,
            type: i.invoice_type,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            total: parseFloat(i.total),
            amountPaid: parseFloat(i.amount_paid) || 0,
            amountDue: parseFloat(i.amount_due) || parseFloat(i.total),
            currency: i.currency || 'EUR',
            status: i.status
        })),
        chantiers: chantiersResult.rows.map(c => ({
            id: c.id,
            name: c.name,
            reference: c.reference,
            status: c.status,
            startDate: c.start_date,
            endDate: c.end_date,
            budgetEstimate: c.budget_estimate ? parseFloat(c.budget_estimate) : null,
            color: c.color,
            updatedAt: c.updated_at
        }))
    };
}

// ------------------------------------------------------------
// Charge les infos de l'entreprise (pour l'affichage)
// ------------------------------------------------------------
async function getCompanyInfo(userId) {
    const result = await pool.query(`
        SELECT company_name, address, siret, tva, phone, email, website, logo,
               vat_regime, vat_rate, language
        FROM settings WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) return {};

    const s = result.rows[0];
    return {
        companyName: s.company_name,
        address: s.address,
        siret: s.siret,
        tva: s.tva,
        phone: s.phone,
        email: s.email,
        website: s.website,
        logo: s.logo,
        vatRegime: s.vat_regime,
        vatRate: parseFloat(s.vat_rate) || 21,
        language: s.language || 'fr'
    };
}

// ------------------------------------------------------------
// Charge les infos du client
// ------------------------------------------------------------
async function getClientInfo(userId, clientId) {
    const result = await pool.query(
        'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
        [clientId, userId]
    );

    if (result.rows.length === 0) return null;

    const c = result.rows[0];
    return {
        id: c.id,
        name: c.name,
        contactName: c.contact_name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        vatNumber: c.vat_number,
        notes: c.notes
    };
}

// ------------------------------------------------------------
// Met a jour les coordonnees d'un client (depuis le portail)
// ------------------------------------------------------------
async function updateClientInfo(userId, clientId, updates) {
    const allowed = ['contact_name', 'email', 'phone', 'address', 'vat_number'];
    const fields = [];
    const values = [];
    let idx = 1;

    const mapping = {
        contactName: 'contact_name',
        email: 'email',
        phone: 'phone',
        address: 'address',
        vatNumber: 'vat_number'
    };

    for (const [key, val] of Object.entries(updates)) {
        const col = mapping[key];
        if (!col || !allowed.includes(col)) continue;
        fields.push(col + ' = $' + idx);
        values.push(val || null);
        idx++;
    }

    if (fields.length === 0) return false;

    values.push(clientId, userId);

    await pool.query(
        'UPDATE clients SET ' + fields.join(', ') + ', updated_at = NOW() WHERE id = $' + idx + ' AND user_id = $' + (idx + 1),
        values
    );

    return true;
}

// ------------------------------------------------------------
// Log une action du client
// ------------------------------------------------------------
async function logClientAction(clientAccountId, userId, action, ip, userAgent, details) {
    try {
        await pool.query(`
            INSERT INTO client_account_logs (client_account_id, user_id, action, ip_address, user_agent, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [clientAccountId, userId, action, ip || null, userAgent || null, details ? JSON.stringify(details) : null]);
    } catch (err) {
        console.warn('Erreur logClientAction:', err.message);
    }
}

// ------------------------------------------------------------
// Revoque le compte d'un client (desactive)
// ------------------------------------------------------------
async function revokeClientAccount(userId, clientId) {
    const result = await pool.query(`
        UPDATE client_accounts
        SET active = FALSE, updated_at = NOW()
        WHERE user_id = $1 AND client_id = $2
        RETURNING id
    `, [userId, clientId]);

    return result.rows.length > 0;
}

module.exports = {
    JWT_SECRET,
    generateInvitationToken,
    generateClientJwt,
    createOrRefreshInvitation,
    verifyInvitationToken,
    acceptInvitation,
    loginClient,
    verifyClientJwt,
    getClientDocuments,
    getCompanyInfo,
    getClientInfo,
    updateClientInfo,
    logClientAction,
    revokeClientAccount
};