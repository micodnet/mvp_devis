// backend/utils/email/importer.js
// Analyse d'email client pour extraire les donnees d'un devis

const OpenAI = require('openai');
const { pool } = require('../../db');
const {
    calculerDevisMultiMetiers,
    calculerDevisDepuisTexte
} = require('../assistant/metiers');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY
    });
}

const GROQ_MODELS = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b'
];

// ------------------------------------------------------------
// Extrait l'email et le nom d'expediteur d'un texte brut
// ------------------------------------------------------------
function extractSender(text) {
    const result = { fromEmail: null, fromName: null, subject: null };

    const emailMatch = text.match(/(?:De|From)\s*:\s*([^\n<]+)<([^>]+)>/i);
    if (emailMatch) {
        result.fromName = emailMatch[1].trim();
        result.fromEmail = emailMatch[2].trim();
    } else {
        const emailOnly = text.match(/(?:De|From)\s*:\s*([^\s]+@[^\s]+)/i);
        if (emailOnly) result.fromEmail = emailOnly[1].trim();
    }

    const subjectMatch = text.match(/(?:Objet|Subject|Sujet)\s*:\s*([^\n]+)/i);
    if (subjectMatch) result.subject = subjectMatch[1].trim();

    return result;
}

// ------------------------------------------------------------
// Nettoie le texte de l'email (retirer signatures, en-tetes)
// ------------------------------------------------------------
function cleanEmailText(text) {
    if (!text) return '';

    let cleaned = text;

    // Retirer les en-tetes De/A/Objet si presents
    cleaned = cleaned.replace(/^(De|From|À|To|A|Objet|Subject|Sujet|Date|Cc|Bcc)\s*:.*$/gim, '');

    // Retirer les citations (lignes commencant par >)
    cleaned = cleaned.replace(/^>.*$/gm, '');

    // Retirer les signatures courantes
    cleaned = cleaned.replace(/--\s*\n[\s\S]*$/m, '');
    cleaned = cleaned.replace(/Cordialement[\s\S]*$/i, '');
    cleaned = cleaned.replace(/Bien à vous[\s\S]*$/i, '');
    cleaned = cleaned.replace(/Bien cordialement[\s\S]*$/i, '');
    cleaned = cleaned.replace(/Sent from my.*$/im, '');

    // Nettoyer les lignes vides multiples
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

// ------------------------------------------------------------
// Utilise Groq pour extraire les donnees structurees
// ------------------------------------------------------------
async function extractWithAI(emailText, products, services) {
    if (!groqClient) {
        return { success: false, error: 'Assistant IA non configure.' };
    }

    const productList = products.slice(0, 50).map(p =>
        '- ' + (p.ref || '') + ' | ' + p.name + ' | ' + p.unitPrice + ' EUR'
    ).join('\n');

    const serviceList = services.slice(0, 30).map(s =>
        '- ' + (s.ref || '') + ' | ' + s.name + ' | ' + s.unitPrice + ' EUR/' + (s.unit || 'u')
    ).join('\n');

    const prompt = `Tu es un assistant qui extrait les informations d'une demande client (email) pour créer un devis.

EMAIL DU CLIENT :
"""
${emailText.slice(0, 3000)}
"""

CATALOGUE PRODUITS DISPONIBLES :
${productList || '(aucun)'}

SERVICES DISPONIBLES :
${serviceList || '(aucun)'}

Extrait les informations suivantes et réponds en JSON strict :

{
  "clientName": "Nom du client ou de l'entreprise, ou null",
  "clientEmail": "Email du client, ou null",
  "clientPhone": "Téléphone si mentionné, ou null",
  "clientAddress": "Adresse si mentionnée, ou null",
  "requestType": "Devis de travaux" ou "Commande de produits" ou "Autre",
  "description": "Résumé de la demande en 1-2 phrases",
  "items": [
    {
      "type": "product" ou "service" ou "custom",
      "ref": "Référence du produit si trouvé dans le catalogue, sinon null",
      "name": "Nom de l'article ou du service",
      "qty": nombre,
      "unitPrice": prix unitaire en euros (utilise le catalogue si trouvé, sinon estime),
      "notes": "Notes particulieres, ou null"
    }
  ],
  "suggestedMetier": "peinture" ou "placo" ou "carrelage" ou "parquet" ou "maconnerie" ou "electricite" ou "plomberie" ou "toiture" ou "isolation" ou "terrassement" ou null,
  "suggestedDimensions": "Dimensions si mentionnees (ex: 3m x 2.5m), sinon null",
  "urgency": "normale" ou "urgente" ou "passee",
  "notes": "Toute autre information pertinente"
}

REGLE IMPORTANTE :
- Si l'email mentionne un type de travaux (peinture, placo, carrelage, etc.) ET des dimensions, mets-les dans suggestedMetier et suggestedDimensions.
- Pour les items, si l'article est trouvé dans le catalogue, utilise la référence et le prix exact du catalogue.
- Si l'article n'est pas dans le catalogue, mets type="custom" et estime un prix raisonnable.
- Ne mets AUCUN texte en dehors du JSON.`;

    let lastError = null;
    for (const model of GROQ_MODELS) {
        try {
            const completion = await groqClient.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0].message.content;
            const parsed = JSON.parse(content);

            return {
                success: true,
                data: parsed,
                model: model
            };
        } catch (err) {
            console.warn('Erreur extraction IA (' + model + '):', err.message);
            lastError = err;
        }
    }

    return {
        success: false,
        error: 'Analyse IA echouee : ' + (lastError?.message || 'inconnu')
    };
}

// ------------------------------------------------------------
// Point d'entree : analyse un email et prepare le devis
// ------------------------------------------------------------
async function analyzeEmail(userId, rawText, options = {}) {
    if (!rawText || rawText.trim().length < 20) {
        return { success: false, error: 'Le texte de l\'email est trop court.' };
    }

    const { fromEmail, fromName, subject } = extractSender(rawText);
    const cleanedText = cleanEmailText(rawText);

    // Charger le catalogue
    const productsResult = await pool.query(
        'SELECT ref, name, unit_price, unit FROM products WHERE user_id = $1',
        [userId]
    );
    const servicesResult = await pool.query(
        'SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE',
        [userId]
    );

    const products = productsResult.rows.map(p => ({
        ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price), unit: p.unit
    }));
    const services = servicesResult.rows.map(s => ({
        ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
        unit: s.unit, isLabor: s.is_labor
    }));

    // Extraire avec l'IA
    const extraction = await extractWithAI(cleanedText, products, services);
    if (!extraction.success) {
        return { success: false, error: extraction.error };
    }

    const data = extraction.data;

    // Si l'IA a detecte un metier + dimensions, on utilise le calculateur metier
    let calculatedItems = null;
    let calculatedLogs = null;

    if (data.suggestedMetier && data.suggestedDimensions) {
        const metierText = data.suggestedMetier + ' ' + data.suggestedDimensions;
        const calcResult = await calculerDevisDepuisTexte(metierText, products, services);

        if (calcResult.success) {
            calculatedItems = calcResult.items;
            calculatedLogs = calcResult.logs;
        }
    }

    // Enregistrer l'import
    const importResult = await pool.query(`
        INSERT INTO email_imports (
            user_id, raw_text, from_email, from_name, subject,
            extracted_data, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'analyzed')
        RETURNING id
    `, [
        userId,
        rawText.slice(0, 10000),
        fromEmail || options.fromEmail || null,
        fromName || options.fromName || null,
        subject || options.subject || null,
        JSON.stringify(data)
    ]);

    return {
        success: true,
        importId: importResult.rows[0].id,
        data: data,
        calculated: calculatedItems ? {
            items: calculatedItems,
            logs: calculatedLogs
        } : null,
        sender: {
            email: fromEmail,
            name: fromName,
            subject: subject
        }
    };
}

// ------------------------------------------------------------
// Genere un devis a partir d'un email analyse
// ------------------------------------------------------------
async function convertToQuote(userId, importId, overrides = {}) {
    const importResult = await pool.query(
        'SELECT * FROM email_imports WHERE id = $1 AND user_id = $2',
        [importId, userId]
    );

    if (importResult.rows.length === 0) {
        throw new Error('Import introuvable.');
    }

    const imp = importResult.rows[0];
    const data = imp.extracted_data || {};

    // Determiner les items finaux
    let items = overrides.items || null;

    if (!items) {
        if (imp.calculated_data && imp.calculated_data.items) {
            items = imp.calculated_data.items;
        } else if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            items = data.items.map(it => ({
                ref: it.ref || 'EXT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
                name: it.name || 'Article',
                qty: parseFloat(it.qty) || 1,
                unitPrice: parseFloat(it.unitPrice) || 0,
                total: (parseFloat(it.qty) || 1) * (parseFloat(it.unitPrice) || 0)
            }));
        }
    }

    if (!items || items.length === 0) {
        throw new Error('Aucun article extrait de l\'email.');
    }

    // Calculer les totaux
    let subtotal = 0;
    for (const it of items) {
        subtotal += parseFloat(it.total) || (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Charger les settings
    const settingsResult = await pool.query(
        'SELECT * FROM settings WHERE user_id = $1',
        [userId]
    );
    const settings = settingsResult.rows[0] || {};
    const vatRegime = overrides.vatRegime || settings.vat_regime || 'franchise';
    const vatRate = parseFloat(settings.vat_rate) || 21;
    const vatAmount = vatRegime === 'assujetti'
        ? Math.round(subtotal * (vatRate / 100) * 100) / 100
        : 0;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    // Numero de devis
    const counterResult = await pool.query(
        'SELECT last_number FROM counters WHERE user_id = $1',
        [userId]
    );
    let newNumber = 1;
    if (counterResult.rows.length > 0) {
        newNumber = counterResult.rows[0].last_number + 1;
        await pool.query('UPDATE counters SET last_number = $1 WHERE user_id = $2', [newNumber, userId]);
    } else {
        await pool.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 1)', [userId]);
    }
    const quoteNumber = 'DEVIS-' + String(newNumber).padStart(4, '0') + '-' + new Date().getFullYear();

    const issueDate = new Date().toISOString().slice(0, 10);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);
    const validDate = validUntil.toISOString().slice(0, 10);

    const clientName = overrides.clientName || data.clientName || imp.from_name || 'Client email';
    const clientEmail = overrides.clientEmail || data.clientEmail || imp.from_email || null;
    const clientAddress = overrides.clientAddress || data.clientAddress || null;

    const insertResult = await pool.query(`
        INSERT INTO quotes (
            user_id, quote_number, issue_date, valid_date,
            subtotal, vat_amount, total, vat_regime, status, items,
            client_name, client_address, client_email,
            currency, exchange_rate
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, 'EUR', 1.0)
        RETURNING id, quote_number
    `, [
        userId, quoteNumber, issueDate, validDate,
        subtotal, vatAmount, total, vatRegime,
        JSON.stringify(items),
        clientName, clientAddress, clientEmail
    ]);

    // Lier l'import au devis
    await pool.query(
        'UPDATE email_imports SET quote_id = $1, status = $2 WHERE id = $3',
        [insertResult.rows[0].id, 'converted', importId]
    );

    return {
        quoteId: insertResult.rows[0].id,
        quoteNumber: insertResult.rows[0].quote_number,
        subtotal,
        vatAmount,
        total,
        items,
        clientName,
        clientEmail
    };
}

module.exports = {
    analyzeEmail,
    convertToQuote,
    extractSender,
    cleanEmailText
};