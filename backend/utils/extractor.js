// /*
//  * extractor.js - AI extraction engine for quotes
//  */
// // Le catalogue n'est plus lu en dur : il est passé en paramètre depuis server.js
// // const { products } = require('../data/price-db.json');
// // console.log(`Catalog loaded: ${products.length} products available.`);

// // ============================================================
// // 1. AI PROVIDERS INITIALIZATION
// // ============================================================

// let groqClient = null;
// let openRouterClient = null;

// try {
//     const OpenAI = require('openai');

//     if (process.env.GROQ_API_KEY) {
//         groqClient = new OpenAI({
//             baseURL: 'https://api.groq.com/openai/v1',
//             apiKey: process.env.GROQ_API_KEY,
//         });
//         console.log('Groq connected (primary).');
//     } else {
//         console.log('GROQ_API_KEY missing.');
//     }

//     if (process.env.OPENROUTER_API_KEY) {
//         openRouterClient = new OpenAI({
//             baseURL: 'https://openrouter.ai/api/v1',
//             apiKey: process.env.OPENROUTER_API_KEY,
//         });
//         console.log('OpenRouter connected (fallback).');
//     }
// } catch (e) {
//     console.log('OpenAI SDK not loaded.');
// }

// function escapeRegex(str) {
//     return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// }

// // ============================================================
// // 2. ROBUST JSON EXTRACTION
// // ============================================================
// // Handles:
// //   - Plain array: [ {...} ]
// //   - Wrapped object: { "items": [ {...} ] }
// //   - Code fences: ```json ... ```
// //   - Trailing text after JSON

// function extractJSON(rawData) {
//     // Remove code fences
//     let cleaned = String(rawData)
//         .replace(/```json/gi, '')
//         .replace(/```/g, '')
//         .trim();

//     // Try direct parse first
//     try {
//         const direct = JSON.parse(cleaned);
//         if (Array.isArray(direct)) return direct;
//         if (direct && Array.isArray(direct.items)) return direct.items;
//         if (direct && Array.isArray(direct.articles)) return direct.articles;
//         if (direct && Array.isArray(direct.products)) return direct.products;
//     } catch (e) { /* continue */ }

//     // Try to locate a JSON array
//     const arrStart = cleaned.indexOf('[');
//     const arrEnd = cleaned.lastIndexOf(']');
//     if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
//         const candidate = cleaned.substring(arrStart, arrEnd + 1);
//         try {
//             const parsed = JSON.parse(candidate);
//             if (Array.isArray(parsed)) return parsed;
//         } catch (e) { /* continue */ }
//     }

//     // Try to locate a JSON object
//     const objStart = cleaned.indexOf('{');
//     const objEnd = cleaned.lastIndexOf('}');
//     if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
//         const candidate = cleaned.substring(objStart, objEnd + 1);
//         try {
//             const parsed = JSON.parse(candidate);
//             if (parsed && Array.isArray(parsed.items)) return parsed.items;
//             if (parsed && Array.isArray(parsed.articles)) return parsed.articles;
//             if (parsed && Array.isArray(parsed.products)) return parsed.products;
//             if (Array.isArray(parsed)) return parsed;
//         } catch (e) { /* continue */ }
//     }

//     console.warn('extractJSON: could not parse. Raw response:', cleaned.slice(0, 300));
//     throw new Error('No valid JSON found.');
// }

// // ============================================================
// // 3. AI PROVIDER CALLS
// // ============================================================

// async function callGroq(prompt) {
//     if (!groqClient) throw new Error('Groq not initialized');

//     // Only models that are currently valid on Groq
//     const models = [
//         'openai/gpt-oss-120b',
//         'openai/gpt-oss-20b',
//     ];

//     let lastError = null;
//     for (const model of models) {
//         try {
//             const response = await groqClient.chat.completions.create({
//                 model: model,
//                 messages: [
//                     {
//                         role: 'system',
//                         content: 'You are a JSON-only extraction assistant. You always reply with a valid JSON array, nothing else. No explanations, no markdown, no code fences.'
//                     },
//                     { role: 'user', content: prompt }
//                 ],
//                 temperature: 0.1,
//                 max_tokens: 1200,
//                 response_format: { type: 'json_object' },
//             });
//             const content = response.choices[0].message.content;
//             console.log(`Groq responded with model: ${model}`);
//             return extractJSON(content);
//         } catch (err) {
//             console.warn(`Groq (${model}) failed: ${err.message}`);
//             lastError = err;
//         }
//     }
//     throw lastError || new Error('All Groq models failed');
// }

// async function callKeylessAI(prompt) {
//     const controller = new AbortController();
//     const timeout = setTimeout(() => controller.abort(), 15000);
//     try {
//         const response = await fetch('https://keylessai.thryx.workers.dev/v1/chat/completions', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             signal: controller.signal,
//             body: JSON.stringify({
//                 model: 'gpt-4o',
//                 messages: [{ role: 'user', content: prompt }],
//                 temperature: 0.1,
//                 max_tokens: 1200,
//             }),
//         });
//         clearTimeout(timeout);
//         if (!response.ok) throw new Error(`KeylessAI error: ${response.status}`);
//         const data = await response.json();
//         return extractJSON(data.choices[0].message.content);
//     } catch (err) {
//         clearTimeout(timeout);
//         throw err;
//     }
// }

// async function callOpenRouter(prompt) {
//     if (!openRouterClient) throw new Error('OpenRouter not initialized');
//     const response = await openRouterClient.chat.completions.create({
//         model: 'google/gemini-2.0-flash-lite-preview-02-05:free',
//         messages: [{ role: 'user', content: prompt }],
//         temperature: 0.1,
//         max_tokens: 1200,
//     });
//     return extractJSON(response.choices[0].message.content);
// }

// // ============================================================
// // 4. LOCAL FALLBACK
// // ============================================================

// function localFallback(text, logs, products) {
//     logs.push('[Fallback] Searching local catalog (price-db.json).');
//     const results = [];
//     const lowerText = text.toLowerCase();

//     products.forEach(product => {
//         const name = product.name.toLowerCase();
//         const ref = product.ref.toLowerCase();

//         if (lowerText.includes(name) || lowerText.includes(ref)) {
//             let qty = 1;
//             const safeName = escapeRegex(product.name);
//             const regex = new RegExp(
//                 `(\\b\\d{1,3})\\s+(?:x\\s+|unités?\\s+|pièces?\\s+|articles?\\s+)?${safeName}`,
//                 'i'
//             );
//             const match = text.match(regex);
//             if (match) {
//                 const parsed = parseInt(match[1]);
//                 if (parsed >= 1 && parsed <= 999) qty = parsed;
//             }
//             results.push({
//                 ref: product.ref,
//                 name: product.name,
//                 qty: qty,
//                 unitPrice: product.unitPrice,
//                 total: qty * product.unitPrice,
//             });
//             logs.push(`[Fallback] "${product.name}" found -> ${qty} unit(s).`);
//         }
//     });

//     if (results.length === 0) {
//         logs.push('[Fallback] No product from the catalog found in the document.');
//         return [];
//     }
//     return results;
// }

// // ============================================================
// // 5. PRODUCT MATCHING
// // ============================================================

// // function matchProducts(extractedItems, logs, providerName, products) {
// //     if (!Array.isArray(extractedItems) || extractedItems.length === 0) {
// //         logs.push(`${providerName} returned no items.`);
// //         return null;
// //     }

// //     logs.push(`${providerName} extracted ${extractedItems.length} items.`);
// //     return extractedItems.map(item => {
// //         // Safely resolve name/ref
// //         const itemName = String(item.name || item.designation || item.label || '').trim();
// //         const itemRef = String(item.ref || item.reference || item.sku || '').trim();

// //         const product = products.find(p =>
// //             (itemRef && p.ref === itemRef) ||
// //             (itemName && p.name.toLowerCase().includes(itemName.toLowerCase())) ||
// //             (itemName && itemName.toLowerCase().includes(p.name.toLowerCase()))
// //         );

// //         if (product) {
// //             logs.push(`[Match] "${itemName}" -> ${product.ref} (${product.unitPrice}€/u)`);
// //             const q = Math.max(1, parseInt(item.qty) || 1);
// //             return {
// //                 ref: product.ref,
// //                 name: product.name,
// //                 qty: q,
// //                 unitPrice: product.unitPrice,
// //                 total: q * product.unitPrice,
// //             };
// //         } else {
// //             let unitPrice = parseFloat(item.unitPrice || item.price || 0);
// //             if (!unitPrice || isNaN(unitPrice) || unitPrice <= 0) {
// //                 unitPrice = 15.00;
// //                 logs.push(`[Default] "${itemName || 'Unnamed'}" not found, price 15.00€/u`);
// //             } else {
// //                 logs.push(`[Document] "${itemName}" price read: ${unitPrice}€/u`);
// //             }
// //             const q = Math.max(1, parseInt(item.qty) || 1);
// //             return {
// //                 ref: itemRef || 'EXT-' + String(Math.random()).slice(2, 6),
// //                 name: itemName || 'Unnamed item',
// //                 qty: q,
// //                 unitPrice,
// //                 total: q * unitPrice,
// //             };
// //         }
// //     });
// // }
// // fonction match avec comparaison de score de mot similaire et plus de match strict
// // Normalise une chaîne : minuscules + suppression des accents + nettoyage
// function normalize(str) {
//     return String(str || '')
//         .toLowerCase()
//         .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
//         .replace(/[^a-z0-9\s]/g, ' ')                     // remplace tout sauf lettres/chiffres par espace
//         .replace(/\s+/g, ' ')
//         .trim();
// }

// // Retire le 's' final des mots (pluriel simple : câbles -> cable)
// function singularize(word) {
//     if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
//         return word.slice(0, -1);
//     }
//     return word;
// }

// // Score de similarité : compte les mots en commun (avec singulier/pluriel géré)
// function wordMatchScore(text1, text2) {
//     const words1 = normalize(text1).split(' ').filter(w => w.length > 2).map(singularize);
//     const words2 = normalize(text2).split(' ').filter(w => w.length > 2).map(singularize);
//     if (words1.length === 0 || words2.length === 0) return 0;
//     let matches = 0;
//     for (const w of words1) {
//         if (words2.includes(w)) matches++;
//     }
//     // Score = proportion de mots en commun
//     return matches / Math.max(words1.length, words2.length);
// }

// // Trouve le meilleur produit du catalogue pour un item extrait
// function findBestProduct(itemName, itemRef, products) {
//     if (!products || products.length === 0) return null;

//     // 1. Match exact par référence (le plus fiable)
//     if (itemRef) {
//         const byRef = products.find(p => p.ref && normalize(p.ref) === normalize(itemRef));
//         if (byRef) return { product: byRef, score: 1, reason: 'ref-exact' };
//     }

//     // 2. Match exact par nom
//     const itemNorm = normalize(itemName);
//     if (!itemNorm) return null;

//     const byExactName = products.find(p => normalize(p.name) === itemNorm);
//     if (byExactName) return { product: byExactName, score: 1, reason: 'name-exact' };

//     // 3. Match par inclusion (l'un contient l'autre)
//     const byContains = products.find(p => {
//         const pNorm = normalize(p.name);
//         return pNorm.includes(itemNorm) || itemNorm.includes(pNorm);
//     });
//     if (byContains) return { product: byContains, score: 0.9, reason: 'name-contains' };

//     // 4. Match par score de mots en commun (gère le pluriel)
//     let best = null;
//     let bestScore = 0;
//     for (const p of products) {
//         const score = wordMatchScore(itemName, p.name);
//         if (score > bestScore) {
//             bestScore = score;
//             best = p;
//         }
//     }

//     // Seuil : au moins 50% de mots en commun
//     if (best && bestScore >= 0.5) {
//         return { product: best, score: bestScore, reason: 'word-match' };
//     }

//     return null;
// }

// function matchProducts(extractedItems, logs, providerName, products) {
//     if (!Array.isArray(extractedItems) || extractedItems.length === 0) {
//         logs.push(`${providerName} returned no items.`);
//         return null;
//     }

//     logs.push(`${providerName} extracted ${extractedItems.length} items.`);
//     return extractedItems.map(item => {
//         const itemName = String(item.name || item.designation || item.label || '').trim();
//         const itemRef = String(item.ref || item.reference || item.sku || '').trim();

//         const match = findBestProduct(itemName, itemRef, products);

//         if (match) {
//             const p = match.product;
//             const q = Math.max(1, parseInt(item.qty) || 1);
//             logs.push(`[Match] "${itemName}" -> ${p.ref || 'N/R'} "${p.name}" (${p.unitPrice}€/u) [${match.reason}]`);
//             return {
//                 ref: p.ref,
//                 name: p.name,
//                 qty: q,
//                 unitPrice: p.unitPrice,
//                 total: q * p.unitPrice,
//             };
//         } else {
//             // Pas de match dans le catalogue → utiliser le prix du document ou défaut
//             let unitPrice = parseFloat(item.unitPrice || item.price || 0);
//             if (!unitPrice || isNaN(unitPrice) || unitPrice <= 0) {
//                 unitPrice = 15.00;
//                 logs.push(`[Default] "${itemName || 'Unnamed'}" not in catalog, price 15.00€/u`);
//             } else {
//                 logs.push(`[Document] "${itemName}" price read: ${unitPrice}€/u`);
//             }
//             const q = Math.max(1, parseInt(item.qty) || 1);
//             return {
//                 ref: itemRef || 'EXT-' + String(Math.random()).slice(2, 6),
//                 name: itemName || 'Unnamed item',
//                 qty: q,
//                 unitPrice,
//                 total: q * unitPrice,
//             };
//         }
//     });
// }
// // ============================================================
// // 6. MAIN ORCHESTRATOR
// // ============================================================

// async function extractItemsFromText(text, products = []) {
//     const logs = [];

//     const prompt = `Extract all requested items from the following customer request text.

// TEXT:
// """
// ${text.slice(0, 3000)}
// """

// Return a JSON OBJECT with a single key "items" that contains an ARRAY of item objects.
// Each item must have exactly these keys:
// - "ref": string (use the product reference if visible, otherwise generate one starting with "EXT")
// - "name": string (the product name or description)
// - "qty": number (quantity, minimum 1)
// - "unitPrice": number (unit price if mentioned, otherwise 0)

// Example output:
// {"items":[{"ref":"REF-1001","name":"Ampoule LED 10W","qty":5,"unitPrice":12.5}]}

// RULES:
// - Reply with JSON ONLY. No text before or after.
// - No markdown, no code fences.
// - If no items can be extracted, reply: {"items":[]}`;

//     const providers = [
//         { name: 'Groq', fn: callGroq, available: !!groqClient },
//         { name: 'KeylessAI', fn: callKeylessAI, available: true },
//         { name: 'OpenRouter', fn: callOpenRouter, available: !!openRouterClient },
//     ];

//     let finalItems = null;

//     for (const provider of providers) {
//         if (!provider.available) continue;
//         try {
//             logs.push(`[${provider.name}] Attempt...`);
//             const extracted = await provider.fn(prompt);
//             const matched = matchProducts(extracted, logs, provider.name, products);
//             if (matched && matched.length > 0) {
//                 finalItems = matched;
//                 logs.push(`[${provider.name}] Success!`);
//                 break;
//             } else {
//                 logs.push(`[${provider.name}] No items matched, trying next provider.`);
//             }
//         } catch (err) {
//             logs.push(`[${provider.name}] Failed: ${err.message}`);
//         }
//     }

//     if (!finalItems) {
//         logs.push('All providers failed, switching to local fallback.');
//         finalItems = localFallback(text, logs, products);
//     }

//     const total = finalItems.reduce((sum, item) => sum + item.total, 0);
//     logs.push(`Total: ${total.toFixed(2)} €`);

//     return { items: finalItems, logs };
// }

// module.exports = { extractItemsFromText };

// backend/utils/assistant/orchestrator.js
// Orchestre : intention → outil → réponse naturelle

const OpenAI = require('openai');
const { detectIntent } = require('./assistant/router');
const tools = require('./assistant/tools');
const { ACTIONS } = require('./assistant/actions');
const { calculerDevisDepuisTexte, calculerDevisMultiMetiers } = require('./assistant/metiers');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
}

const GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

// ------------------------------------------------------------
// Fallback : extrait un nom depuis un message (utilisé quand
// l'IA n'a pas rempli le patch d'update_quote)
// ------------------------------------------------------------
const NAME_BLACKLIST = new Set([
    'vincent', 'client', 'devis', 'bonjour', 'merci', 'salut', 'modifie', 'modifier',
    'ajoute', 'ajouter', 'change', 'changer', 'mets', 'mettre', 'nom', 'dernier',
    'premier', 'nouveau', 'ancien', 'bon', 'bonne', 'oui', 'non', 'ok', 'd accord',
    'le', 'la', 'les', 'un', 'une', 'des', 'ce', 'cette', 'mon', 'ma', 'mes'
]);

function extractFallbackName(message) {
    if (!message || typeof message !== 'string') return null;
    const txt = message.trim();

    // Stratégie 1 : patterns explicites
    const patterns = [
        /nom\s+(?:de|du\s+client|d')\s*:?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /(?:mettre|mets|ajoute[rz]?|rajoute[rz]?|assigner?)\s+([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60}?)\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
        /client\s*[:=]\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i
    ];

    for (const re of patterns) {
        const m = txt.match(re);
        if (m && m[1]) {
            let name = m[1].trim()
                .replace(/[.,!?;:]+$/, '')
                .replace(/\s+(s'il|svp|merci|please).*$/i, '')
                .trim();
            name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
            if (name.length >= 2) {
                console.log(`✅ [Fallback] Nom extrait (pattern) : "${name}"`);
                return name;
            }
        }
    }

    // Stratégie 2 : mots capitalisés consécutifs
    const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}){0,3})\b/g;
    const candidates = [];
    let match;
    while ((match = capitalPattern.exec(txt)) !== null) {
        candidates.push(match[1]);
    }

    const validCandidates = candidates.filter(c => {
        const firstWord = c.split(/\s+/)[0];
        if (NAME_BLACKLIST.has(firstWord.toLowerCase())) return false;
        if (c.length < 2 || c.length > 60) return false;
        return true;
    });

    if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => b.length - a.length);
        const name = validCandidates[0];
        console.log(`✅ [Fallback] Nom extrait (capitales) : "${name}"`);
        return name;
    }

    // Stratégie 3 : réponse courte (2-4 mots)
    const words = txt.replace(/[.,!?;:]+$/, '').trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && txt.length <= 40) {
        const actionWords = /(devis|client|modifi|ajout|chang|mets|comme|nom|dernier|sur|dans|pour|avec)/i;
        if (!actionWords.test(txt)) {
            const name = words.join(' ');
            const capitalized = name.replace(/\b\w/g, l => l.toUpperCase());
            console.log(`✅ [Fallback] Nom extrait (court) : "${capitalized}"`);
            return capitalized;
        }
    }

    return null;
}

// ------------------------------------------------------------
// Exécute l'intention
// ------------------------------------------------------------
async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
    // Charger les préférences utilisateur
    let userPrefs = null;
    try {
        const { getUserPreferences } = require('./preferences');
        userPrefs = await getUserPreferences(userId);
    } catch (err) {
        console.warn('Impossible de charger les préférences:', err.message);
    }

    // ==========================================================
    // FALLBACK UNIQUE pour update_quote : si pas de patch, on essaie
    // d'extraire un nom depuis le message ou l'historique
    // ==========================================================
    if (intent === 'update_quote') {
        const hasPatch = args && args.patch && typeof args.patch === 'object' && Object.keys(args.patch).length > 0;

        if (!hasPatch) {
            console.log('🛟 [update_quote] Aucun patch → activation du fallback');

            let extractedName = extractFallbackName(userMessage);

            // Regarder les derniers messages utilisateur de l'historique
            if (!extractedName && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
                const lastUserMsgs = conversationHistory
                    .filter(m => m.role === 'user')
                    .slice(-2)
                    .reverse();
                for (const msg of lastUserMsgs) {
                    extractedName = extractFallbackName(msg.text);
                    if (extractedName) break;
                }
            }

            // Dernier recours : si le message est très court et ne contient aucun verbe d'action
            if (!extractedName && userMessage && userMessage.trim().length >= 3 && userMessage.trim().length <= 40) {
                const trimmed = userMessage.trim().replace(/[.,!?;:]+$/, '');
                if (!/(devis|client|modifi|ajout|chang|mets|bonjour|merci|salut|oui|non)/i.test(trimmed)) {
                    extractedName = trimmed.replace(/\b\w/g, l => l.toUpperCase());
                }
            }

            if (extractedName) {
                console.log(`✅ [update_quote] Nom forcé : "${extractedName}"`);
                args = { ...(args || {}), patch: { clientName: extractedName } };
            } else {
                console.log('❌ [update_quote] Impossible d\'extraire un nom');
                return {
                    error: 'Je n\'ai pas réussi à identifier ce que vous voulez modifier. Précisez par exemple : "Ajoute Vincent Dubois comme client".'
                };
            }
        }
    }

    // Si c'est une action d'écriture, on prépare SANS exécuter
    if (ACTIONS[intent]) {
        const draft = await ACTIONS[intent].prepare(args || {}, userId);
        return { isPendingAction: true, draft };
    }

    // Sinon, lecture normale
    switch (intent) {
        case 'list_products':  return await tools.listProducts(userId, args);
        case 'find_product':   return await tools.findProduct(userId, args);
        case 'list_services':  return await tools.listServices(userId, args);
        case 'list_clients':   return await tools.listClients(userId, args);
        case 'find_client':    return await tools.findClient(userId, args);
        case 'list_suppliers': return await tools.listSuppliers(userId, args);
        case 'list_quotes':    return await tools.listQuotes(userId, args);
        case 'quote_stats':    return await tools.getQuoteStats(userId);
        case 'list_invoices':  return await tools.listInvoices(userId, args);
        case 'invoice_stats':  return await tools.getInvoiceStats(userId);
        case 'stock_alerts':   return await tools.getStockAlerts(userId);
        case 'general_stats':  return await tools.getGeneralStats(userId);

        case 'calculer_metier':
        case 'calculer_chantier': {
            const { pool } = require('../../db');
            const [productsResult, servicesResult] = await Promise.all([
                pool.query('SELECT ref, name, unit_price FROM products WHERE user_id = $1', [userId]),
                pool.query('SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE', [userId])
            ]);
            const products = productsResult.rows.map(p => ({
                ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price)
            }));
            const services = servicesResult.rows.map(s => ({
                ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
                unit: s.unit, isLabor: s.is_labor
            }));

            // Appliquer les corrections vocales si présentes
            let description = args.description || '';
            if (userPrefs && userPrefs.voiceCorrections) {
                const { applyVoiceCorrections } = require('./preferences');
                description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
            }

            const result = intent === 'calculer_chantier'
                ? await calculerDevisMultiMetiers(description, products, services)
                : await calculerDevisDepuisTexte(description, products, services);

            if (!result.success) return { error: result.error };

            // Appliquer le taux horaire utilisateur et la marge
            const { getHourlyRateForMetier, applyMargin } = require('./preferences');

            if (userPrefs) {
                const metierName = result.metier || (result.metiers && result.metiers[0]) || null;
                result.items = result.items.map(item => {
                    if (item.ref && item.ref.startsWith('MO-')) {
                        const taux = getHourlyRateForMetier(userPrefs, metierName);
                        item.unitPrice = taux;
                        item.total = Math.round(item.qty * taux * 100) / 100;
                    }
                    return item;
                });

                if (userPrefs.defaultMarginPercent > 0) {
                    result.items = result.items.map(item => {
                        if (!item.ref || !item.ref.startsWith('MO-')) {
                            item.unitPrice = applyMargin(item.unitPrice, userPrefs.defaultMarginPercent);
                            item.total = Math.round(item.qty * item.unitPrice * 100) / 100;
                        }
                        return item;
                    });
                }
            }

            const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);

            const previewLines = {
                'Nombre de lignes': result.items.length,
                'Temps total': `${result.heures} h`,
                'Total HT': subtotal.toFixed(2) + ' €'
            };

            if (result.metier) {
                previewLines['Métier détecté'] = result.metier;
                if (result.surface) previewLines['Surface'] = `${result.surface} m²`;
            } else if (result.metiers) {
                previewLines['Métiers détectés'] = result.metiers.join(', ');
            }

            // Réordonner : métier d'abord
            const orderedPreview = {};
            if (previewLines['Métier détecté']) orderedPreview['Métier détecté'] = previewLines['Métier détecté'];
            if (previewLines['Métiers détectés']) orderedPreview['Métiers détectés'] = previewLines['Métiers détectés'];
            if (previewLines['Surface']) orderedPreview['Surface'] = previewLines['Surface'];
            orderedPreview['Nombre de lignes'] = previewLines['Nombre de lignes'];
            orderedPreview['Temps total'] = previewLines['Temps total'];
            orderedPreview['Total HT'] = previewLines['Total HT'];

            return {
                isPendingAction: true,
                draft: {
                    type: 'create_quote_simple',
                    summary: `Créer un devis ${result.metier || 'chantier'} (${result.items.length} lignes, ${result.heures} h)`,
                    preview: orderedPreview,
                    payload: {
                        clientName: args.clientName || 'Client à préciser',
                        items: result.items,
                        vatRegime: userPrefs?.defaultVatRegime || 'franchise',
                        vatRate: userPrefs?.defaultVatRate || 21,
                        logs: result.logs
                    }
                }
            };
        }

        case 'help': return { help: true };
        case 'chat':
        default:
            return null;
    }
}

// ------------------------------------------------------------
// Formate la réponse
// ------------------------------------------------------------
async function formatResponse(userMessage, intent, data, conversationHistory = []) {
    if (data && data.isPendingAction) {
        const d = data.draft;
        let previewText = '';
        for (const [key, val] of Object.entries(d.preview)) {
            previewText += `• ${key} : ${val}\n`;
        }
        return {
            isPendingAction: true,
            message: `Je vais effectuer l'action suivante :\n\n**${d.summary}**\n\n${previewText}\nCliquez sur Confirmer pour valider ou Annuler pour annuler.`,
            draft: d
        };
    }

    if (data && data.error) {
        return { error: data.error };
    }

    if (!groqClient) {
        if (data) return `Données :\n${JSON.stringify(data, null, 2)}`;
        return 'L\'assistant n\'est pas disponible pour le moment.';
    }

    // Contexte conversationnel
    let historyContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recent = conversationHistory.slice(-4);
        historyContext = `\nContexte des derniers messages :\n` +
            recent.map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.text}`).join('\n') + '\n';
    }

    let systemContext = '';

    if (intent === 'help') {
        systemContext = `Tu es l'assistant de Devis Express Pro. L'utilisateur demande de l'aide.
Tu peux lui expliquer ces fonctionnalités :
- Créer des devis (onglet Devis, upload d'un PDF/Word/Excel)
- Gérer le catalogue produits
- Gérer les services et la main d'œuvre
- Gérer les clients et les fournisseurs
- Gérer le stock (alertes, mouvements, commandes fournisseurs)
- Gérer les factures
- Gérer l'équipe (invitations, rôles)
- Créer des devis depuis la description d'un chantier
- Envoyer un devis par email
- Modifier un devis existant (client, adresse, email, statut, date)
Réponds en français, chaleureusement, de façon concise.`;
    } else if (data) {
        systemContext = `Tu es l'assistant interne de Devis Express Pro.
L'utilisateur vient de poser cette question : "${userMessage}"

⚠️ Tu as DÉJÀ interrogé la base de données de l'utilisateur et tu as les résultats ci-dessous.
NE DIS JAMAIS que tu n'as pas accès aux données.

Voici les données réelles de SA base :
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Ta mission : formuler une réponse naturelle, claire et concise en français.
Règles STRICTES :
- Utilise uniquement les données ci-dessus, ne les invente pas.
- Si c'est une liste, présente-la avec des puces ou un tableau simple.
- Mets en avant les chiffres importants.
- Si le résultat est vide, dis-le poliment.
- Ne mets JAMAIS de JSON brut dans ta réponse.
- Réponds directement à la question.`;
    } else {
        systemContext = `${historyContext}Tu es l'assistant conversationnel de Devis Express Pro, une application de gestion de devis, factures, stock et clients pour indépendants et TPE.
Réponds en français de façon naturelle, brève et chaleureuse.
Si l'utilisateur te salue, salue-le simplement en retour.
Si le contexte montre qu'on est en train de modifier un devis et qu'on attend un nom de client, guide l'utilisateur pas à pas.`;
    }

    for (const model of GROQ_MODELS) {
        try {
            const completion = await groqClient.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemContext },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 1200,
            });
            return completion.choices[0].message.content.trim();
        } catch (err) {
            console.warn(`Format Groq (${model}) échec: ${err.message}`);
        }
    }

    if (data) return `Voici les données brutes :\n${JSON.stringify(data, null, 2)}`;
    return 'Je n\'ai pas pu générer de réponse. Réessayez.';
}

// ------------------------------------------------------------
// Confirme et exécute une action
// ------------------------------------------------------------
async function confirmAction(draft, userId) {
    if (!draft || !draft.type) throw new Error('Action invalide.');
    const action = ACTIONS[draft.type];
    if (!action) throw new Error('Action inconnue : ' + draft.type);
    const result = await action.execute(draft.payload, userId);
    return result;
}

// ------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------
async function chat(userMessage, userId, conversationHistory = []) {
    const start = Date.now();

    const { intent, args } = await detectIntent(userMessage, conversationHistory);
    const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);
    const response = await formatResponse(userMessage, intent, data, conversationHistory);

    return {
        response,
        intent,
        hasData: !!data,
        durationMs: Date.now() - start
    };
}

module.exports = { chat, confirmAction };