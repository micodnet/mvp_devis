// backend/utils/signature/eidas-signer.js
// Signature électronique renforcée conforme eIDAS (niveau AES)

const crypto = require('crypto');
const { pool } = require('../../db');

// ------------------------------------------------------------
// Calcule l'empreinte SHA-256 d'une chaîne ou d'un buffer
// ------------------------------------------------------------
function computeHash(data) {
    if (!data) return null;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ------------------------------------------------------------
// Calcule l'empreinte d'un devis (contenu signé)
// ------------------------------------------------------------
function computeQuoteHash(quote) {
    // On hashe les données essentielles du devis
    const payload = {
        quoteNumber: quote.quote_number,
        issueDate: quote.issue_date,
        validDate: quote.valid_date,
        clientName: quote.client_name,
        clientAddress: quote.client_address,
        clientVat: quote.client_vat,
        clientEmail: quote.client_email,
        items: quote.items,
        subtotal: parseFloat(quote.subtotal) || 0,
        vatAmount: parseFloat(quote.vat_amount) || 0,
        total: parseFloat(quote.total) || 0,
        vatRegime: quote.vat_regime
    };
    return computeHash(JSON.stringify(payload));
}

// ------------------------------------------------------------
// Génère un token de vérification unique
// ------------------------------------------------------------
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ------------------------------------------------------------
// Enregistre un événement dans l'audit trail
// ------------------------------------------------------------
async function logAuditEvent(userId, quoteId, eventType, eventData = {}, req = null) {
    try {
        const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() 
                || req?.socket?.remoteAddress 
                || null;
        const userAgent = req?.headers?.['user-agent'] || null;

        await pool.query(`
            INSERT INTO signature_audit 
                (user_id, quote_id, event_type, event_data, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [userId, quoteId, eventType, JSON.stringify(eventData), ip, userAgent]);
    } catch (err) {
        console.error('Erreur logAuditEvent:', err.message);
    }
}

// ------------------------------------------------------------
// Signe un devis (enregistre toutes les preuves)
// ------------------------------------------------------------
async function signQuote(quoteId, userId, signerData, req) {
    const { method, signedBy, signatureData, accepted, email } = signerData;

    // 1. Charger le devis
    const quoteResult = await pool.query(
        'SELECT * FROM quotes WHERE id = $1',
        [quoteId]
    );
    if (quoteResult.rows.length === 0) {
        throw new Error('Devis introuvable.');
    }
    const quote = quoteResult.rows[0];

    if (quote.signature_signed_at) {
        throw new Error('Ce devis est déjà signé.');
    }

    // 2. Calculer l'empreinte du devis
    const quoteHash = computeQuoteHash(quote);

    // 3. Générer un token de vérification unique
    const verificationToken = generateVerificationToken();

    // 4. Horodatage
    const timestamp = new Date();
    const timestampSource = 'server_utc'; // On pourrait utiliser un TSA externe

    // 5. IP et User-Agent
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() 
            || req?.socket?.remoteAddress 
            || 'unknown';
    const userAgent = req?.headers?.['user-agent'] || 'unknown';

    // 6. Enregistrer la signature
    await pool.query(`
        UPDATE quotes
        SET signature_method = $1,
            signature_data = $2,
            signature_signed_at = $3,
            signature_signed_by = $4,
            signature_ip = $5,
            signature_user_agent = $6,
            signature_hash = $7,
            signature_timestamp = $8,
            signature_timestamp_source = $9,
            signature_verification_token = $10,
            status = 'accepted',
            updated_at = NOW()
        WHERE id = $11
    `, [
        method,
        method === 'draw' ? signatureData : null,
        timestamp,
        signedBy.trim(),
        ip,
        userAgent,
        quoteHash,
        timestamp,
        timestampSource,
        verificationToken,
        quoteId
    ]);

    // 7. Log audit
    await logAuditEvent(userId, quoteId, 'signed', {
        method,
        signedBy,
        hash: quoteHash,
        timestamp: timestamp.toISOString()
    }, req);

    return {
        quoteHash,
        verificationToken,
        timestamp: timestamp.toISOString(),
        signedBy: signedBy.trim(),
        method
    };
}

// ------------------------------------------------------------
// Vérifie l'intégrité d'un devis signé
// ------------------------------------------------------------
async function verifyQuoteIntegrity(quoteIdOrToken) {
    // Trouver le devis par ID ou token
    let quoteResult;
    if (typeof quoteIdOrToken === 'number' || /^\d+$/.test(quoteIdOrToken)) {
        quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1',
            [parseInt(quoteIdOrToken)]
        );
    } else {
        quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE signature_verification_token = $1 OR public_token = $1',
            [quoteIdOrToken]
        );
    }

    if (quoteResult.rows.length === 0) {
        return { valid: false, error: 'Devis introuvable' };
    }

    const quote = quoteResult.rows[0];

    if (!quote.signature_signed_at) {
        return { 
            valid: false, 
            error: 'Ce devis n\'a pas encore été signé',
            quote: {
                id: quote.id,
                number: quote.quote_number,
                client: quote.client_name
            }
        };
    }

    // Recalculer l'empreinte actuelle
    const currentHash = computeQuoteHash(quote);

    // Comparer avec l'empreinte enregistrée
    const hashMatch = currentHash === quote.signature_hash;

    return {
        valid: hashMatch,
        quote: {
            id: quote.id,
            number: quote.quote_number,
            client: quote.client_name,
            signedBy: quote.signature_signed_by,
            signedAt: quote.signature_signed_at,
            method: quote.signature_method,
            hash: quote.signature_hash,
            currentHash,
            token: quote.signature_verification_token
        },
        message: hashMatch 
            ? 'Signature valide. Le document n\'a pas été modifié depuis la signature.'
            : 'Signature invalide. Le document a été modifié après signature.'
    };
}

// ------------------------------------------------------------
// Génère le certificat de signature (audit trail complet)
// ------------------------------------------------------------
async function generateSignatureCertificate(quoteId, userId) {
    const quoteResult = await pool.query(
        'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
        [quoteId, userId]
    );
    if (quoteResult.rows.length === 0) {
        throw new Error('Devis introuvable.');
    }
    const quote = quoteResult.rows[0];

    if (!quote.signature_signed_at) {
        throw new Error('Ce devis n\'a pas encore été signé.');
    }

    // Charger l'audit trail
    const auditResult = await pool.query(`
        SELECT * FROM signature_audit 
        WHERE quote_id = $1 
        ORDER BY created_at ASC
    `, [quoteId]);

    // Charger les paramètres entreprise
    const settingsResult = await pool.query(
        'SELECT company_name, address, siret, tva, email, phone FROM settings WHERE user_id = $1',
        [userId]
    );
    const settings = settingsResult.rows[0] || {};

    return {
        quote: {
            number: quote.quote_number,
            issueDate: quote.issue_date,
            validDate: quote.valid_date,
            clientName: quote.client_name,
            clientEmail: quote.client_email,
            subtotal: parseFloat(quote.subtotal) || 0,
            vatAmount: parseFloat(quote.vat_amount) || 0,
            total: parseFloat(quote.total) || 0,
            vatRegime: quote.vat_regime
        },
        signature: {
            signedBy: quote.signature_signed_by,
            signedAt: quote.signature_signed_at,
            method: quote.signature_method,
            hash: quote.signature_hash,
            timestamp: quote.signature_timestamp,
            timestampSource: quote.signature_timestamp_source,
            ip: quote.signature_ip,
            userAgent: quote.signature_user_agent,
            token: quote.signature_verification_token,
            data: quote.signature_data
        },
        company: settings,
        auditTrail: auditResult.rows.map(row => ({
            event: row.event_type,
            date: row.created_at,
            ip: row.ip_address,
            userAgent: row.user_agent,
            data: row.event_data
        }))
    };
}

// ------------------------------------------------------------
// Génère le hash du PDF final (après génération)
// ------------------------------------------------------------
async function hashFinalPDF(quoteId, pdfBuffer) {
    const pdfHash = computeHash(pdfBuffer);
    await pool.query(`
        UPDATE quotes
        SET signature_pdf_hash = $1, updated_at = NOW()
        WHERE id = $2
    `, [pdfHash, quoteId]);
    return pdfHash;
}

module.exports = {
    computeHash,
    computeQuoteHash,
    generateVerificationToken,
    logAuditEvent,
    signQuote,
    verifyQuoteIntegrity,
    generateSignatureCertificate,
    hashFinalPDF
};