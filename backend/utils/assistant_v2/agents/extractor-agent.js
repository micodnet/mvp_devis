// backend/utils/assistant/agents/extractor-agent.js
// Agent 2 : Extraction de paramètres structurés depuis du texte libre.
// Générique : reçoit un schéma, retourne un objet conforme.

const llm = require('../llm/client');
const prompts = require('../llm/prompts');

/**
 * Extrait des données structurées depuis un texte.
 * @param {string} text - Le texte à analyser
 * @param {Object} schema - Le schéma attendu (ex: { name: 'string', email: 'string?' })
 * @param {Object} opts
 * @param {Object} opts.hints - Indices supplémentaires (ex: { nameBlacklist: [...] })
 * @returns {Promise<Object>} Objet conforme au schéma
 */
async function extract({ text, schema, hints = {} }) {
    if (!text || typeof text !== 'string') return {};
    if (!schema || typeof schema !== 'object') return {};

    // Enrichir le schéma avec les hints
    const enrichedSchema = enrichSchema(schema, hints);

    try {
        const result = await llm.chatJSON({
            system: prompts.EXTRACTOR_SYSTEM,
            user: prompts.buildExtractorUser({ text, schema: enrichedSchema }),
            tier: 'light',
            temperature: 0.1,
            maxTokens: 500,
        });

        // Post-traitement : nettoyage
        const cleaned = cleanResult(result, schema);
        console.log(`📤 [Extractor] ${Object.keys(cleaned).filter(k => cleaned[k] != null).length}/${Object.keys(schema).length} champs extraits`);
        return cleaned;
    } catch (err) {
        console.warn(`⚠️  [Extractor] Échec : ${err.message}`);
        return {};
    }
}

/**
 * Enrichit le schéma avec des contraintes (blacklist, format, etc.)
 */
function enrichSchema(schema, hints) {
    const out = {};
    for (const [key, type] of Object.entries(schema)) {
        out[key] = { type, hint: hints[key] || undefined };
    }
    return out;
}

/**
 * Nettoie le résultat : trim, null si vide, applique la casse pour les noms.
 */
function cleanResult(result, schema) {
    const out = {};
    for (const [key, type] of Object.entries(schema)) {
        let val = result[key];

        // Nettoyer les chaînes
        if (typeof val === 'string') {
            val = val.trim();
            if (val === '' || val === 'null' || val === 'undefined') val = null;
            // Retirer les guillemets parasites
            val = val.replace(/^["'`]+|["'`]+$/g, '');
        }

        // Cast selon le type
        const isOptional = type.endsWith('?');
        const baseType = type.replace('?', '');

        if (val === null || val === undefined) {
            out[key] = null;
            continue;
        }

        switch (baseType) {
            case 'number':
                const n = parseFloat(String(val).replace(',', '.'));
                out[key] = isNaN(n) ? null : n;
                break;
            case 'boolean':
                out[key] = val === true || val === 'true' || val === 'oui' || val === 'yes';
                break;
            case 'string':
            default:
                out[key] = val;
                break;
        }
    }
    return out;
}

/**
 * Extraction de secours LOCALE (sans LLM) pour les cas simples.
 * Utile quand le LLM échoue ou pour les noms.
 */
function extractFallback(text, options = {}) {
    if (!text || typeof text !== 'string') return null;
    const txt = text.trim();
    const blacklist = options.blacklist || [];

    // Stratégie 1 : "nom de X", "client : X", "client c'est X"
    const patterns = [
        /nom\s+(?:de|du\s+client|d')\s*:?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /(?:mettre|mets|ajoute[rz]?|rajoute[rz]?|assigner?)\s+([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60}?)\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
    ];

    for (const re of patterns) {
        const m = txt.match(re);
        if (m && m[1]) {
            let name = m[1].trim()
                .replace(/[.,!?;:]+$/, '')
                .replace(/\s+(s'il|svp|merci|please).*$/i, '')
                .trim();
            name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
            if (name.length >= 2 && !blacklist.includes(name.toLowerCase())) return name;
        }
    }

    // Stratégie 2 : mots capitalisés
    const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+){0,3})\b/g;
    const candidates = [];
    let match;
    while ((match = capitalPattern.exec(txt)) !== null) candidates.push(match[1]);

    const valid = candidates.filter(c => {
        const first = c.split(/\s+/)[0].toLowerCase();
        return !blacklist.includes(first) && c.length >= 2 && c.length <= 60;
    });

    if (valid.length > 0) {
        valid.sort((a, b) => b.length - a.length);
        return valid[0];
    }

    return null;
}

module.exports = { extract, extractFallback };