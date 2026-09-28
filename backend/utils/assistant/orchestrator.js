// backend/utils/assistant/orchestrator.js
// Orchestre : intention → outil → réponse naturelle

const OpenAI = require('openai');
const { detectIntent } = require('./router');
const tools = require('./tools');
const { ACTIONS } = require('./actions');
const { calculerDevisDepuisTexte, calculerDevisMultiMetiers } = require('./metiers');
const { getSession, recordAction, recordExchange } = require('./session');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
}

const GROQ_MODELS = [
    'openai/gpt-oss-20b', 
    'openai/gpt-oss-120b'
];

// ------------------------------------------------------------
// Fallback : extrait un nom depuis un message
// ------------------------------------------------------------
const NAME_BLACKLIST = new Set([
    'vincent', 'client', 'devis', 'bonjour', 'merci', 'salut', 'modifie', 'modifier',
    'ajoute', 'ajouter', 'change', 'changer', 'mets', 'mettre', 'nom', 'dernier',
    'premier', 'nouveau', 'ancien', 'bon', 'bonne', 'oui', 'non', 'ok', 'd accord',
    'le', 'la', 'les', 'un', 'une', 'des', 'ce', 'cette', 'mon', 'ma', 'mes'
]);

/**
 * Extraction de secours : essaie de trouver un nom de personne/entreprise
 * dans le message si l'IA n'a pas rempli le patch.
 */
// function extractFallbackName(message) {
//     if (!message) return null;

//     // Pattern 1 : "Vincent Dubois", "Dupont SARL", "Marie Leroy"
//     const matches = message.match(/\b[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç]+)+\b/g);
//     if (matches && matches.length > 0) {
//         const blacklist = ['Vincent', 'Client', 'Devis', 'Bonjour', 'Merci'];
//         const valid = matches.filter(m => !blacklist.includes(m.split(' ')[0]));
//         if (valid.length > 0) {
//             valid.sort((a, b) => b.length - a.length);
//             return valid[0];
//         }
//     }

//     // Pattern 2 : "nom de X", "client : X", "client c'est X"
//     const simpleMatch = message.match(/(?:nom\s+(?:de|du\s+client)\s*:?\s*|client\s*(?:c['']est|:)\s*)([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç]+)?)/i);
//     if (simpleMatch) return simpleMatch[1];

//     return null;
// }
function extractFallbackName(message) {
    if (!message || typeof message !== 'string') return null;
    const txt = message.trim();

    // ---- Stratégie 1 : phrase avec "nom de X", "nom du client X", etc. ----
    // Capture tout ce qui suit "nom de", "nom du client", "client :", "client c'est"
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
            // Nettoyer les articles parasites au début
            name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
            if (name.length >= 2) return name;
        }
    }

    // ---- Stratégie 2 : 1 à 4 mots consécutifs capitalisés (n'importe où) ----
    // Ex: "Vincent Dubois", "Marie Leroy", "Dupont SARL"
    const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}){0,3})\b/g;
    const candidates = [];
    let match;
    while ((match = capitalPattern.exec(txt)) !== null) candidates.push(match[1]);

    // Filtrer les candidats valides
    const validCandidates = candidates.filter(c => {
        const firstWord = c.split(/\s+/)[0];
        if (NAME_BLACKLIST.has(firstWord.toLowerCase())) return false;
        if (c.length < 2 || c.length > 60) return false;
        return true;
    });

    if (validCandidates.length > 0) {
        // Prendre le plus long (le plus probable d'être un nom complet)
        validCandidates.sort((a, b) => b.length - a.length);
        const name = validCandidates[0];
        return name;
    }

    // ---- Stratégie 3 : réponse courte (ex: "vincent dubois" en minuscules) ----
    // Si le message fait moins de 40 caractères et ressemble à un nom (2 mots)
    const words = txt.replace(/[.,!?;:]+$/, '').trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && txt.length <= 40) {
        // Vérifie qu'il n'y a pas de mots-clés d'action dedans
        const actionWords = /(devis|client|modifi|ajout|chang|mets|comme|nom|dernier|sur|dans|pour|avec)/i;
        if (!actionWords.test(txt)) {
            const name = words.join(' ');
            // Capitaliser la première lettre de chaque mot
            const capitalized = name.replace(/\b\w/g, l => l.toUpperCase());
            return capitalized
        }
    }

    return null;
}

// ------------------------------------------------------------
// Exécute l'intention
// ------------------------------------------------------------
/**
 * Appelle l'outil correspondant a l'intention detectee.
 */
// async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
//     // Charger les preferences utilisateur
//     let userPrefs = null;
//     try {
//         const { getUserPreferences } = require('./preferences');
//         userPrefs = await getUserPreferences(userId);
//     } catch (err) {
//         console.warn('Impossible de charger les preferences:', err.message);
//     }

//     // Fallback : si l'intent est update_quote mais patch vide, on essaie d'extraire
//     if (intent === 'update_quote') {
//         const hasPatch = args && args.patch && typeof args.patch === 'object' && Object.keys(args.patch).length > 0;

//         if (!hasPatch) {
//             console.log('update_quote sans patch, activation du fallback');

//             let fallbackName = extractFallbackName(userMessage);

//             if (!fallbackName && conversationHistory && conversationHistory.length > 0) {
//                 const lastAssistant = [...conversationHistory].reverse().find(m => m.role === 'assistant');
//                 if (lastAssistant && /client|nom/i.test(lastAssistant.text)) {
//                     const trimmed = (userMessage || '').trim().replace(/[.,!?;:]+$/, '');
//                     if (trimmed.length >= 2 && trimmed.length <= 60) {
//                         const capitalized = trimmed.replace(/\b\w/g, l => l.toUpperCase());
//                         if (!/^(Vincent|Client|Devis|Bonjour|Merci|Oui|Non|Ok)$/i.test(capitalized)) {
//                             fallbackName = capitalized;
//                         }
//                     }
//                 }
//             }

//             if (!fallbackName && userMessage && userMessage.trim().length >= 2 && userMessage.trim().length <= 40) {
//                 const trimmed = userMessage.trim().replace(/[.,!?;:]+$/, '');
//                 if (!/(modifi|ajout|chang|mets|rajout|nom|client|devis|bonjour|merci|salut)/i.test(trimmed)) {
//                     const capitalized = trimmed.replace(/\b\w/g, l => l.toUpperCase());
//                     fallbackName = capitalized;
//                 }
//             }

//             if (fallbackName) {
//                 args = { ...(args || {}), patch: { ...(args?.patch || {}), clientName: fallbackName } };
//                 console.log('Fallback patch applique : clientName = ' + fallbackName);
//             }
//         }
//     }

//     // Si c'est une action d'ecriture, on prepare sans executer
//     if (ACTIONS[intent]) {
//         const draft = await ACTIONS[intent].prepare(args || {}, userId);
//         return {
//             isPendingAction: true,
//             draft
//         };
//     }

//     // Sinon, lecture normale
//     switch (intent) {
//         case 'list_products':    return await tools.listProducts(userId, args);
//         case 'find_product':     return await tools.findProduct(userId, args);
//         case 'list_services':    return await tools.listServices(userId, args);
//         case 'list_clients':     return await tools.listClients(userId, args);
//         case 'find_client':      return await tools.findClient(userId, args);
//         case 'list_suppliers':   return await tools.listSuppliers(userId, args);
//         case 'list_quotes':      return await tools.listQuotes(userId, args);
//         case 'quote_stats':      return await tools.getQuoteStats(userId);
//         case 'list_invoices':    return await tools.listInvoices(userId, args);
//         case 'invoice_stats':    return await tools.getInvoiceStats(userId);
//         case 'stock_alerts':     return await tools.getStockAlerts(userId);
//         case 'general_stats':    return await tools.getGeneralStats(userId);
//         case 'list_chantiers':   return await tools.listChantiers(userId, args);
//         case 'find_chantier':    return await tools.findChantier(userId, args);
//         case 'chantier_stats':   return await tools.getChantierStats(userId);

//         case 'calculer_metier': {
//             const { pool } = require('../../db');
//             const productsResult = await pool.query(
//                 'SELECT ref, name, unit_price FROM products WHERE user_id = $1',
//                 [userId]
//             );
//             const servicesResult = await pool.query(
//                 'SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE',
//                 [userId]
//             );
//             const products = productsResult.rows.map(p => ({
//                 ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price)
//             }));
//             const services = servicesResult.rows.map(s => ({
//                 ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
//                 unit: s.unit, isLabor: s.is_labor
//             }));

//             let description = args.description || '';
//             if (userPrefs && userPrefs.voiceCorrections) {
//                 const { applyVoiceCorrections } = require('./preferences');
//                 description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
//             }

//             const result = await calculerDevisDepuisTexte(description, products, services);

//             if (!result.success) {
//                 return { error: result.error };
//             }

//             if (userPrefs) {
//                 const { getHourlyRateForMetier, applyMargin } = require('./preferences');

//                 result.items = result.items.map(item => {
//                     if (item.ref && item.ref.startsWith('MO-')) {
//                         const taux = getHourlyRateForMetier(userPrefs, result.metier);
//                         item.unitPrice = taux;
//                         item.total = Math.round(item.qty * taux * 100) / 100;
//                     }
//                     return item;
//                 });

//                 if (userPrefs.defaultMarginPercent > 0) {
//                     result.items = result.items.map(item => {
//                         if (!item.ref || !item.ref.startsWith('MO-')) {
//                             item.unitPrice = applyMargin(item.unitPrice, userPrefs.defaultMarginPercent);
//                             item.total = Math.round(item.qty * item.unitPrice * 100) / 100;
//                         }
//                         return item;
//                     });
//                 }
//             }

//             const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);
//             return {
//                 isPendingAction: true,
//                 draft: {
//                     type: 'create_quote_simple',
//                     summary: 'Creer un devis ' + result.metier + ' (' + result.items.length + ' lignes, ' + result.heures + ' h)',
//                     preview: {
//                         'Metier detecte': result.metier,
//                         'Surface / Volume': result.surface ? result.surface + ' m2' : (result.volume ? result.volume + ' m3' : '-'),
//                         'Temps total': result.heures + ' h',
//                         'Nombre de lignes': result.items.length,
//                         'Total HT': subtotal.toFixed(2) + ' EUR'
//                     },
//                     payload: {
//                         clientName: args.clientName || 'Client a preciser',
//                         items: result.items,
//                         vatRegime: userPrefs?.defaultVatRegime || 'franchise',
//                         vatRate: userPrefs?.defaultVatRate || 21,
//                         logs: result.logs
//                     }
//                 }
//             };
//         }

//         case 'calculer_chantier': {
//             const { pool } = require('../../db');
//             const productsResult = await pool.query(
//                 'SELECT ref, name, unit_price FROM products WHERE user_id = $1',
//                 [userId]
//             );
//             const servicesResult = await pool.query(
//                 'SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE',
//                 [userId]
//             );
//             const products = productsResult.rows.map(p => ({
//                 ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price)
//             }));
//             const services = servicesResult.rows.map(s => ({
//                 ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
//                 unit: s.unit, isLabor: s.is_labor
//             }));

//             let description = args.description || '';
//             if (userPrefs && userPrefs.voiceCorrections) {
//                 const { applyVoiceCorrections } = require('./preferences');
//                 description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
//             }

//             const result = await calculerDevisMultiMetiers(description, products, services);

//             if (!result.success) {
//                 return { error: result.error };
//             }

//             return {
//                 isPendingAction: true,
//                 draft: {
//                     type: 'create_quote_simple',
//                     summary: 'Creer un devis chantier (' + result.metiers.length + ' metiers, ' + result.items.length + ' lignes, ' + result.heures + ' h)',
//                     preview: {
//                         'Metiers detectes': result.metiers.join(', '),
//                         'Nombre de metiers': result.metiers.length,
//                         'Nombre de lignes': result.items.length,
//                         'Temps total cumule': result.heures + ' h',
//                         'Total HT': result.subtotal.toFixed(2) + ' EUR'
//                     },
//                     payload: {
//                         clientName: args.clientName || 'Client a preciser',
//                         items: result.items,
//                         vatRegime: userPrefs?.defaultVatRegime || 'franchise',
//                         vatRate: userPrefs?.defaultVatRate || 21,
//                         logs: result.logs
//                     }
//                 }
//             };
//         }

//         case 'help':             return { help: true };
//         case 'chat':
//         default:
//             return null;
//     }
// }
// ------------------------------------------------------------
// Appelle l'outil correspondant à l'intention
// ------------------------------------------------------------
async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
    // Charge les préférences utilisateur (avec fallback en cas d'erreur)
    let userPrefs = null;
    try {
        const { getUserPreferences } = require('./preferences');
        userPrefs = await getUserPreferences(userId);
    } catch (err) { 
        console.warn('Impossible de charger les préférences:', err.message);
    }

    // Fallback update_quote
    if (intent === 'update_quote') {
        const hasPatch = args && args.patch && typeof args.patch === 'object' && Object.keys(args.patch).length > 0;
        
        if (!hasPatch) {
            let extractedName = extractFallbackName(userMessage);
            
            if (!extractedName && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
                const lastUserMsgs = conversationHistory.filter(m => m.role === 'user').slice(-2).reverse();
                
                for (const msg of lastUserMsgs) {
                    extractedName = extractFallbackName(msg.text);
                    if (extractedName) break;
                }

                const lastAssistant = [...conversationHistory].reverse().find(m => m.role === 'assistant');
            
                if (lastAssistant && /client|nom/i.test(lastAssistant.text)) {
                    const trimmed = (userMessage || '').trim().replace(/[.,!?;:]+$/, '');
                    if (trimmed.length >= 2 && trimmed.length <= 60) {
                        const capitalized = trimmed.replace(/\b\w/g, l => l.toUpperCase());
                        if (!/^(Vincent|Client|Devis|Bonjour|Merci|Oui|Non|Ok)$/i.test(capitalized)) {
                            extractedName = capitalized;
                        }
                    }
                }
            }
            if (!extractedName && userMessage && userMessage.trim().length >= 3 && userMessage.trim().length <= 40) {
                const trimmed = userMessage.trim().replace(/[.,!?;:]+$/, '');
                if (!/(devis|client|modifi|ajout|chang|mets|bonjour|merci|salut|oui|non)/i.test(trimmed)) {
                    extractedName = trimmed.replace(/\b\w/g, l => l.toUpperCase());
                }
            }
            if (extractedName) {
                args = { ...(args || {}), patch: { clientName: extractedName } };
            } else {
                return {
                    error: 'Je n\'ai pas réussi à identifier ce que vous voulez modifier. Précisez par exemple : "Ajoute Vincent Dubois comme client".'
                };
            }
        }
    }

    // Actions d'écriture → draft
    if (ACTIONS[intent]) {
        const draft = await ACTIONS[intent].prepare(args || {}, userId);
        return { isPendingAction: true, draft };
    }

    // Lecture
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
        case 'list_chantiers': return await tools.listChantiers(userId, args);
        case 'find_chantier':  return await tools.findChantier(userId, args);
        case 'chantier_stats': return await tools.getChantierStats(userId);
        case 'calculer_metier': {
            const { pool } = require('../../db');
            const productsResult = await pool.query(
                'SELECT ref, name, unit_price FROM products WHERE user_id = $1',
                [userId]
            );
            const servicesResult = await pool.query(
                'SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE',
                [userId]
            );
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
            // calculateQuoteFromText
            const result = await calculerDevisDepuisTexte(description, products, services);

            if (!result.success) {
                return { error: result.error };
            }

            // Appliquer le taux horaire utilisateur et la marge
            const { getHourlyRateForMetier, applyMargin } = require('./preferences');
            
            if (userPrefs) {
                // Remplacer le taux horaire de la main d'œuvre par celui de l'utilisateur
                result.items = result.items.map(item => {
                    if (item.ref && item.ref.startsWith('MO-')) {
                        const taux = getHourlyRateForMetier(userPrefs, result.metier);
                        item.unitPrice = taux;
                        item.total = Math.round(item.qty * taux * 100) / 100;
                    }
                    return item;
                });
                
                // Appliquer la marge sur tous les articles (sauf main d'œuvre)
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
            return {
                isPendingAction: true,
                draft: {
                    type: 'create_quote_simple',
                    summary: `Créer un devis ${result.metier} (${result.items.length} lignes, ${result.heures} h)`,
                    preview: {
                        'Métier détecté': result.metier,
                        'Surface / Volume': result.surface ? `${result.surface} m²` : (result.volume ? `${result.volume} m³` : '—'),
                        'Temps total': `${result.heures} h`,
                        'Nombre de lignes': result.items.length,
                        'Total HT': subtotal.toFixed(2) + ' €'
                    },
                    payload: {
                        clientName: args.clientName || 'Client à préciser',
                        items: result.items,
                        vatRegime: userPrefs?.defaultVatRegime || 'franchise',
                        vatRate: userPrefs?.defaultVatRate || 21,
                        logs: result.logs
                    }
                }
            };
        };
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

            // Applique les corrections vocales
            let description = args.description || '';
            if (userPrefs && userPrefs.voiceCorrections) {
                const { applyVoiceCorrections } = require('./preferences');
                description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
            }

            const result = intent === 'calculer_chantier'
                ? await calculerDevisMultiMetiers(description, products, services)
                : await calculerDevisDepuisTexte(description, products, services);

            if (!result.success) return { error: result.error };

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
            const previewLines = {};
            if (result.metier) previewLines['Métier détecté'] = result.metier;
            if (result.metiers) previewLines['Métiers détectés'] = result.metiers.join(', ');
            if (result.surface) previewLines['Surface'] = `${result.surface} m²`;
            previewLines['Nombre de lignes'] = result.items.length;
            previewLines['Temps total'] = `${result.heures} h`;
            previewLines['Total HT'] = subtotal.toFixed(2) + ' €';

            return {
                isPendingAction: true,
                draft: {
                    type: 'create_quote_simple',
                    summary: `Créer un devis ${result.metier || 'chantier'} (${result.items.length} lignes, ${result.heures} h)`,
                    preview: previewLines,
                    payload: {
                        clientName: args.clientName || 'Client à préciser',
                        items: result.items,
                        vatRegime: userPrefs?.defaultVatRegime || 'franchise',
                        vatRate: userPrefs?.defaultVatRate || 21,
                        logs: result.logs
                    }
                }
            };
        };

        case 'help': return { help: true };
        case 'chat':
        default:
            return null;
    }
}

// ------------------------------------------------------------
// Formate la réponse
// ------------------------------------------------------------
/**
 * Formate la reponse en langage naturel via Groq.
 */
// async function formatResponse(userMessage, intent, data, conversationHistory = []) {
//     // Cas special : action a confirmer
//     if (data && data.isPendingAction) {
//         const d = data.draft;
//         let previewText = '';
//         for (const [key, val] of Object.entries(d.preview)) {
//             previewText += '- ' + key + ' : ' + val + '\n';
//         }
//         return {
//             isPendingAction: true,
//             message: 'Je vais effectuer l\'action suivante :\n\n**' + d.summary + '**\n\n' + previewText + '\nCliquez sur Confirmer pour valider ou Annuler pour annuler.',
//             draft: d
//         };
//     }

//     // Cas d'erreur explicite
//     if (data && data.error) {
//         return { error: data.error };
//     }

//     if (!groqClient) {
//         if (data) return 'Donnees :\n' + JSON.stringify(data, null, 2);
//         return 'L\'assistant n\'est pas disponible pour le moment.';
//     }

//     let historyContext = '';
//     if (conversationHistory && conversationHistory.length > 0) {
//         const recent = conversationHistory.slice(-4);
//         historyContext = '\nContexte des derniers messages :\n' +
//             recent.map(m => (m.role === 'user' ? 'Utilisateur' : 'Assistant') + ' : ' + m.text).join('\n') + '\n';
//     }

//     let systemContext = '';

//     if (intent === 'help') {
//         systemContext = 'Tu es l\'assistant de Devis Express Pro. L\'utilisateur demande de l\'aide.\n' +
//             'Tu peux lui expliquer ces fonctionnalites :\n' +
//             '- Creer des devis (onglet Devis, upload d\'un PDF/Word/Excel)\n' +
//             '- Gerer le catalogue produits\n' +
//             '- Gerer les services et la main d\'oeuvre\n' +
//             '- Gerer les clients et les fournisseurs\n' +
//             '- Gerer le stock (alertes, mouvements, commandes fournisseurs)\n' +
//             '- Gerer les factures\n' +
//             '- Gerer l\'equipe (invitations, roles)\n' +
//             '- Creer des devis depuis la description d\'un chantier\n' +
//             'Reponds en francais, chaleureusement, de facon concise.';
//     } else if (data) {
//         systemContext = 'Tu es l\'assistant interne de Devis Express Pro.\n' +
//             'L\'utilisateur vient de poser cette question : "' + userMessage + '"\n\n' +
//             'Tu as DEJA interroge la base de donnees de l\'utilisateur et tu as les resultats ci-dessous.\n' +
//             'NE DIS JAMAIS que tu n\'as pas acces aux donnees. Tu les as.\n\n' +
//             'Voici les donnees reelles de SA base :\n' +
//             '```json\n' + JSON.stringify(data, null, 2) + '\n```\n\n' +
//             'Ta mission : formuler une reponse naturelle, claire et concise en francais.\n' +
//             'Regles STRICTES :\n' +
//             '- Utilise uniquement les donnees ci-dessus, ne les invente pas.\n' +
//             '- Si c\'est une liste, presente-la avec des puces ou un tableau simple.\n' +
//             '- Mets en avant les chiffres importants.\n' +
//             '- Si le resultat est vide, dis-le poliment.\n' +
//             '- Ne mets JAMAIS de JSON brut dans ta reponse.\n' +
//             '- Ne dis JAMAIS "je n\'ai pas acces a vos donnees" - tu les as deja.\n' +
//             '- Reponds directement a la question.';
//     } else {
//         systemContext = historyContext + 'Tu es l\'assistant conversationnel de Devis Express Pro, une application de gestion de devis, factures, stock et clients pour independants et TPE.\n' +
//             'Reponds en francais de facon naturelle, breve et chaleureuse.\n' +
//             'Si l\'utilisateur te salue, salue-le simplement en retour.\n' +
//             'Si le contexte montre qu\'on est en train de modifier un devis et qu\'on attend un nom de client, guide l\'utilisateur pas a pas.';
//     }

//     let lastError = null;
//     for (const model of GROQ_MODELS) {
//         try {
//             const completion = await groqClient.chat.completions.create({
//                 model: model,
//                 messages: [
//                     { role: 'system', content: systemContext },
//                     { role: 'user', content: userMessage }
//                 ],
//                 temperature: 0.3,
//                 max_tokens: 1200,
//             });
//             console.log('Assistant: reponse via ' + model);
//             return completion.choices[0].message.content.trim();
//         } catch (err) {
//             console.warn('Format Groq (' + model + ') echec: ' + err.message);
//             lastError = err;
//         }
//     }

//     console.warn('Format Groq: tous les modeles ont echoue.');
//     if (data) return 'Voici les donnees brutes :\n' + JSON.stringify(data, null, 2);
//     return 'Je n\'ai pas pu generer de reponse. Reessayez.';
// }
// ------------------------------------------------------------
// Formate la réponse en langage naturel via Groq
// ------------------------------------------------------------
async function formatResponse(userMessage, intent, data, conversationHistory = []) {
    // Cas spécial : action à confirmer
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

    // Cas d'erreur explicite
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
        systemContext = `Tu es Clara, l'assistante de Devis Express Pro. Réponds en français, chaleureusement, de façon concise.`;
    } else if (data) {
        systemContext = `Tu es Clara, l'assistante interne de Devis Express Pro.
            L'utilisateur vient de poser cette question : "${userMessage}"
            ⚠️ Tu as DÉJÀ interrogé la base et tu as les résultats ci-dessous.
            Voici les données réelles :
            \`\`\`json
            ${JSON.stringify(data, null, 2)}
            \`\`\`
            Formule une réponse naturelle en français. Utilise uniquement les données. Pas de JSON brut.`;
    } else {
        systemContext = `${historyContext}Tu es Clara, l'assistante conversationnelle de Devis Express Pro. Réponds en français, brièvement.`;
    }

    let lastError = null;
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
            lastError = err;
        }
    }

    if (data) return `Voici les données brutes :\n${JSON.stringify(data, null, 2)}`;
    return 'Je n\'ai pas pu générer de réponse. Réessayez.';
}

// ------------------------------------------------------------
// Confirme et exécute une action, met à jour la session
// ------------------------------------------------------------
/**
 * Execute reellement une action apres confirmation.
 */
// async function confirmAction(draft, userId) {
//     if (!draft || !draft.type) throw new Error('Action invalide.');
//     const action = ACTIONS[draft.type];
//     if (!action) throw new Error('Action inconnue : ' + draft.type);
//     const result = await action.execute(draft.payload, userId);
//     return result;
// }
async function confirmAction(draft, userId) {
    if (!draft || !draft.type) throw new Error('Action invalide.');
    const action = ACTIONS[draft.type];
    if (!action) throw new Error('Action inconnue : ' + draft.type);
    const result = await action.execute(draft.payload, userId);

    // Mettre à jour la session après exécution
    try {
        const metadata = {};

        // Si c'est une création de devis, mémoriser le nouveau devis
        if (draft.type === 'create_quote_simple' && result.id) {
            metadata.quoteId = result.id;
            metadata.quoteNumber = result.quoteNumber;
            if (draft.payload.clientName && draft.payload.clientName !== 'Client à préciser') {
                metadata.clientName = draft.payload.clientName;
            }
        }

        // Si c'est une modification de devis, mémoriser
        if (draft.type === 'update_quote' && result.id) {
            metadata.quoteId = result.id;
            metadata.quoteNumber = result.quoteNumber;
            if (result.clientName) metadata.clientName = result.clientName;
        }

        if (draft.type === 'duplicate_quote' && result.id) {
            metadata.quoteId = result.id;
            metadata.quoteNumber = result.quoteNumber;
        }

        await recordAction(userId, draft.type, metadata);

        // Enregistrer l'échange dans l'historique récent
        await recordExchange(userId, 'assistant', `Action ${draft.type} exécutée`);
    } catch (sessionErr) {
        console.warn('Erreur mise à jour session:', sessionErr.message);
    }

    return result;
}

// ------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------
/**
 * Point d'entree : recoit le message utilisateur, renvoie la reponse.
 */
// async function chat(userMessage, userId, conversationHistory = []) {
//     const start = Date.now();

//     // 1. Routeur (avec contexte conversationnel)
//     const { intent, args } = await detectIntent(userMessage, conversationHistory);

//     // 2. Execution (avec fallback extraction)
//     const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);

//     // 3. Formatage (avec contexte)
//     const response = await formatResponse(userMessage, intent, data, conversationHistory);

//     return {
//         response,
//         intent,
//         hasData: !!data,
//         durationMs: Date.now() - start
//     };
// }
async function chat(userMessage, userId, conversationHistory = []) {
    const start = Date.now();

    // Enregistrer le message utilisateur dans l'historique de session
    try {
        await recordExchange(userId, 'user', userMessage);
    } catch (e) { /* silencieux */ }

    // 1. Routeur
    const { intent, args } = await detectIntent(userMessage, conversationHistory, userId);
    
    // 2. Exécution
    const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);
    
    // 3. Formatage
    const response = await formatResponse(userMessage, intent, data, conversationHistory);

    // Sécurité : si response n'est pas une string, on la force
    let finalResponse = response;
    if (typeof response !== 'string') {
        if (response && typeof response.message === 'string') {
            finalResponse = response;
        } else if (response && typeof response === 'object') {
            finalResponse = JSON.stringify(response);
        } else {
            finalResponse = String(response);
        }
    }

    // Si une action est en attente, mémoriser qu'on attend une confirmation
    if (data && data.isPendingAction) {
        try {
            const { updateSession, getSession } = require('./session');
            const session = await getSession(userId);
            const newContext = { ...session.context, pendingAction: data.draft.type };
            await updateSession(userId, { context: newContext });
        } catch (e) { /* silencieux */ }
    }

    return {
        response: finalResponse,
        intent,
        hasData: !!data,
        durationMs: Date.now() - start
    };
}

module.exports = { chat, confirmAction };


// const OpenAI = require('openai');
// const { detectIntent } = require('./assistant/router');
// const tools = require('./assistant/tools');
// const { ACTIONS } = require('./assistant/actions');
// const { calculerDevisDepuisTexte, calculerDevisMultiMetiers } = require('./assistant/metiers');

// // Initialisation du client Groq
// let groqClient = null;
// if (process.env.GROQ_API_KEY) {
//     groqClient = new OpenAI({
//         baseURL: 'https://api.groq.com/openai/v1',
//         apiKey: process.env.GROQ_API_KEY,
//     });
// }

// // Modeles Groq disponibles avec fallback
// const GROQ_MODELS = [
//     'openai/gpt-oss-20b', 
//     'openai/gpt-oss-120b'
// ];

// // ------------------------------------------------------------
// // Fallback : extrait un nom depuis un message (utilisé quand
// // l'IA n'a pas rempli le patch d'update_quote)
// // ------------------------------------------------------------
// const NAME_BLACKLIST = new Set([
//     'vincent', 'client', 'devis', 'bonjour', 'merci', 'salut', 'modifie', 'modifier',
//     'ajoute', 'ajouter', 'change', 'changer', 'mets', 'mettre', 'nom', 'dernier',
//     'premier', 'nouveau', 'ancien', 'bon', 'bonne', 'oui', 'non', 'ok', 'd accord',
//     'le', 'la', 'les', 'un', 'une', 'des', 'ce', 'cette', 'mon', 'ma', 'mes'
// ]);

// function extractFallbackName(message) {
//     if (!message || typeof message !== 'string') return null;
//     const txt = message.trim();

//     // Stratégie 1 : patterns explicites
//     const patterns = [
//         /nom\s+(?:de|du\s+client|d')\s*:?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
//         /client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
//         /(?:mettre|mets|ajoute[rz]?|rajoute[rz]?|assigner?)\s+([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60}?)\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
//         /client\s*[:=]\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i
//     ];

//     for (const re of patterns) {
//         const m = txt.match(re);
//         if (m && m[1]) {
//             let name = m[1].trim()
//                 .replace(/[.,!?;:]+$/, '')
//                 .replace(/\s+(s'il|svp|merci|please).*$/i, '')
//                 .trim();
//             name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
//             if (name.length >= 2) {
//                 console.log(`✅ [Fallback] Nom extrait (pattern) : "${name}"`);
//                 return name;
//             }
//         }
//     }

//     // Stratégie 2 : mots capitalisés consécutifs
//     const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}){0,3})\b/g;
//     const candidates = [];
//     let match;
//     while ((match = capitalPattern.exec(txt)) !== null) {
//         candidates.push(match[1]);
//     }

//     const validCandidates = candidates.filter(c => {
//         const firstWord = c.split(/\s+/)[0];
//         if (NAME_BLACKLIST.has(firstWord.toLowerCase())) return false;
//         if (c.length < 2 || c.length > 60) return false;
//         return true;
//     });

//     if (validCandidates.length > 0) {
//         validCandidates.sort((a, b) => b.length - a.length);
//         const name = validCandidates[0];
//         console.log(`✅ [Fallback] Nom extrait (capitales) : "${name}"`);
//         return name;
//     }

//     // Stratégie 3 : réponse courte (2-4 mots)
//     const words = txt.replace(/[.,!?;:]+$/, '').trim().split(/\s+/);
//     if (words.length >= 2 && words.length <= 4 && txt.length <= 40) {
//         const actionWords = /(devis|client|modifi|ajout|chang|mets|comme|nom|dernier|sur|dans|pour|avec)/i;
//         if (!actionWords.test(txt)) {
//             const name = words.join(' ');
//             const capitalized = name.replace(/\b\w/g, l => l.toUpperCase());
//             console.log(`✅ [Fallback] Nom extrait (court) : "${capitalized}"`);
//             return capitalized;
//         }
//     }

//     return null;
// }

// // ------------------------------------------------------------
// // Exécute l'intention
// // ------------------------------------------------------------
// async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
//     // Charger les préférences utilisateur
//     let userPrefs = null;
//     try {
//         const { getUserPreferences } = require('./preferences');
//         userPrefs = await getUserPreferences(userId);
//     } catch (err) {
//         console.warn('Impossible de charger les préférences:', err.message);
//     }

//     // ==========================================================
//     // FALLBACK UNIQUE pour update_quote : si pas de patch, on essaie
//     // d'extraire un nom depuis le message ou l'historique
//     // ==========================================================
//     if (intent === 'update_quote') {
//         const hasPatch = args && args.patch && typeof args.patch === 'object' && Object.keys(args.patch).length > 0;

//         if (!hasPatch) {
//             console.log('🛟 [update_quote] Aucun patch → activation du fallback');

//             let extractedName = extractFallbackName(userMessage);

//             // Regarder les derniers messages utilisateur de l'historique
//             if (!extractedName && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
//                 const lastUserMsgs = conversationHistory
//                     .filter(m => m.role === 'user')
//                     .slice(-2)
//                     .reverse();
//                 for (const msg of lastUserMsgs) {
//                     extractedName = extractFallbackName(msg.text);
//                     if (extractedName) break;
//                 }
//             }

//             // Dernier recours : si le message est très court et ne contient aucun verbe d'action
//             if (!extractedName && userMessage && userMessage.trim().length >= 3 && userMessage.trim().length <= 40) {
//                 const trimmed = userMessage.trim().replace(/[.,!?;:]+$/, '');
//                 if (!/(devis|client|modifi|ajout|chang|mets|bonjour|merci|salut|oui|non)/i.test(trimmed)) {
//                     extractedName = trimmed.replace(/\b\w/g, l => l.toUpperCase());
//                 }
//             }

//             if (extractedName) {
//                 console.log(`✅ [update_quote] Nom forcé : "${extractedName}"`);
//                 args = { ...(args || {}), patch: { clientName: extractedName } };
//             } else {
//                 console.log('❌ [update_quote] Impossible d\'extraire un nom');
//                 return {
//                     error: 'Je n\'ai pas réussi à identifier ce que vous voulez modifier. Précisez par exemple : "Ajoute Vincent Dubois comme client".'
//                 };
//             }
//         }
//     }

//     // Si c'est une action d'écriture, on prépare SANS exécuter
//     if (ACTIONS[intent]) {
//         const draft = await ACTIONS[intent].prepare(args || {}, userId);
//         return { isPendingAction: true, draft };
//     }

//     // Sinon, lecture normale
//     switch (intent) {
//         case 'list_products':  return await tools.listProducts(userId, args);
//         case 'find_product':   return await tools.findProduct(userId, args);
//         case 'list_services':  return await tools.listServices(userId, args);
//         case 'list_clients':   return await tools.listClients(userId, args);
//         case 'find_client':    return await tools.findClient(userId, args);
//         case 'list_suppliers': return await tools.listSuppliers(userId, args);
//         case 'list_quotes':    return await tools.listQuotes(userId, args);
//         case 'quote_stats':    return await tools.getQuoteStats(userId);
//         case 'list_invoices':  return await tools.listInvoices(userId, args);
//         case 'invoice_stats':  return await tools.getInvoiceStats(userId);
//         case 'stock_alerts':   return await tools.getStockAlerts(userId);
//         case 'general_stats':  return await tools.getGeneralStats(userId);

//         case 'calculer_metier':
//         case 'calculer_chantier': {
//             const { pool } = require('../../db');
//             const [productsResult, servicesResult] = await Promise.all([
//                 pool.query('SELECT ref, name, unit_price FROM products WHERE user_id = $1', [userId]),
//                 pool.query('SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE', [userId])
//             ]);
//             const products = productsResult.rows.map(p => ({
//                 ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price)
//             }));
//             const services = servicesResult.rows.map(s => ({
//                 ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
//                 unit: s.unit, isLabor: s.is_labor
//             }));

//             // Appliquer les corrections vocales si présentes
//             let description = args.description || '';
//             if (userPrefs && userPrefs.voiceCorrections) {
//                 const { applyVoiceCorrections } = require('./preferences');
//                 description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
//             }

//             const result = intent === 'calculer_chantier'
//                 ? await calculerDevisMultiMetiers(description, products, services)
//                 : await calculerDevisDepuisTexte(description, products, services);

//             if (!result.success) return { error: result.error };

//             // Appliquer le taux horaire utilisateur et la marge
//             const { getHourlyRateForMetier, applyMargin } = require('./preferences');

//             if (userPrefs) {
//                 const metierName = result.metier || (result.metiers && result.metiers[0]) || null;
//                 result.items = result.items.map(item => {
//                     if (item.ref && item.ref.startsWith('MO-')) {
//                         const taux = getHourlyRateForMetier(userPrefs, metierName);
//                         item.unitPrice = taux;
//                         item.total = Math.round(item.qty * taux * 100) / 100;
//                     }
//                     return item;
//                 });

//                 if (userPrefs.defaultMarginPercent > 0) {
//                     result.items = result.items.map(item => {
//                         if (!item.ref || !item.ref.startsWith('MO-')) {
//                             item.unitPrice = applyMargin(item.unitPrice, userPrefs.defaultMarginPercent);
//                             item.total = Math.round(item.qty * item.unitPrice * 100) / 100;
//                         }
//                         return item;
//                     });
//                 }
//             }

//             const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);

//             const previewLines = {
//                 'Nombre de lignes': result.items.length,
//                 'Temps total': `${result.heures} h`,
//                 'Total HT': subtotal.toFixed(2) + ' €'
//             };

//             if (result.metier) {
//                 previewLines['Métier détecté'] = result.metier;
//                 if (result.surface) previewLines['Surface'] = `${result.surface} m²`;
//             } else if (result.metiers) {
//                 previewLines['Métiers détectés'] = result.metiers.join(', ');
//             }

//             // Réordonner : métier d'abord
//             const orderedPreview = {};
//             if (previewLines['Métier détecté']) orderedPreview['Métier détecté'] = previewLines['Métier détecté'];
//             if (previewLines['Métiers détectés']) orderedPreview['Métiers détectés'] = previewLines['Métiers détectés'];
//             if (previewLines['Surface']) orderedPreview['Surface'] = previewLines['Surface'];
//             orderedPreview['Nombre de lignes'] = previewLines['Nombre de lignes'];
//             orderedPreview['Temps total'] = previewLines['Temps total'];
//             orderedPreview['Total HT'] = previewLines['Total HT'];

//             return {
//                 isPendingAction: true,
//                 draft: {
//                     type: 'create_quote_simple',
//                     summary: `Créer un devis ${result.metier || 'chantier'} (${result.items.length} lignes, ${result.heures} h)`,
//                     preview: orderedPreview,
//                     payload: {
//                         clientName: args.clientName || 'Client à préciser',
//                         items: result.items,
//                         vatRegime: userPrefs?.defaultVatRegime || 'franchise',
//                         vatRate: userPrefs?.defaultVatRate || 21,
//                         logs: result.logs
//                     }
//                 }
//             };
//         }

//         case 'help': return { help: true };
//         case 'chat':
//         default:
//             return null;
//     }
// }

// // ------------------------------------------------------------
// // Formate la réponse
// // ------------------------------------------------------------
// async function formatResponse(userMessage, intent, data, conversationHistory = []) {
//     if (data && data.isPendingAction) {
//         const d = data.draft;
//         let previewText = '';
//         for (const [key, val] of Object.entries(d.preview)) {
//             previewText += `• ${key} : ${val}\n`;
//         }
//         return {
//             isPendingAction: true,
//             message: `Je vais effectuer l'action suivante :\n\n**${d.summary}**\n\n${previewText}\nCliquez sur Confirmer pour valider ou Annuler pour annuler.`,
//             draft: d
//         };
//     }

//     if (data && data.error) {
//         return { error: data.error };
//     }

//     if (!groqClient) {
//         if (data) return `Données :\n${JSON.stringify(data, null, 2)}`;
//         return 'L\'assistant n\'est pas disponible pour le moment.';
//     }

//     // Contexte conversationnel
//     let historyContext = '';
//     if (conversationHistory && conversationHistory.length > 0) {
//         const recent = conversationHistory.slice(-4);
//         historyContext = `\nContexte des derniers messages :\n` +
//             recent.map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.text}`).join('\n') + '\n';
//     }

//     let systemContext = '';

//     if (intent === 'help') {
//         systemContext = `Tu es l'assistant de Devis Express Pro. L'utilisateur demande de l'aide.
//         Tu peux lui expliquer ces fonctionnalités :
//         - Créer des devis (onglet Devis, upload d'un PDF/Word/Excel)
//         - Gérer le catalogue produits
//         - Gérer les services et la main d'œuvre
//         - Gérer les clients et les fournisseurs
//         - Gérer le stock (alertes, mouvements, commandes fournisseurs)
//         - Gérer les factures
//         - Gérer l'équipe (invitations, rôles)
//         - Créer des devis depuis la description d'un chantier
//         - Envoyer un devis par email
//         - Modifier un devis existant (client, adresse, email, statut, date)
//         Réponds en français, chaleureusement, de façon concise.`;
//             } else if (data) {
//                 systemContext = `Tu es l'assistant interne de Devis Express Pro.
//         L'utilisateur vient de poser cette question : "${userMessage}"

//         ⚠️ Tu as DÉJÀ interrogé la base de données de l'utilisateur et tu as les résultats ci-dessous.
//         NE DIS JAMAIS que tu n'as pas accès aux données.

//         Voici les données réelles de SA base :
//         \`\`\`json
//         ${JSON.stringify(data, null, 2)}
//         \`\`\`

//         Ta mission : formuler une réponse naturelle, claire et concise en français.
//         Règles STRICTES :
//         - Utilise uniquement les données ci-dessus, ne les invente pas.
//         - Si c'est une liste, présente-la avec des puces ou un tableau simple.
//         - Mets en avant les chiffres importants.
//         - Si le résultat est vide, dis-le poliment.
//         - Ne mets JAMAIS de JSON brut dans ta réponse.
//         - Réponds directement à la question.`;
//             } else {
//                 systemContext = `${historyContext}Tu es l'assistant conversationnel de Devis Express Pro, une application de gestion de devis, factures, stock et clients pour indépendants et TPE.
//         Réponds en français de façon naturelle, brève et chaleureuse.
//         Si l'utilisateur te salue, salue-le simplement en retour.
//         Si le contexte montre qu'on est en train de modifier un devis et qu'on attend un nom de client, guide l'utilisateur pas à pas.`;
//     }

//     for (const model of GROQ_MODELS) {
//         try {
//             const completion = await groqClient.chat.completions.create({
//                 model: model,
//                 messages: [
//                     { role: 'system', content: systemContext },
//                     { role: 'user', content: userMessage }
//                 ],
//                 temperature: 0.3,
//                 max_tokens: 1200,
//             });
//             return completion.choices[0].message.content.trim();
//         } catch (err) {
//             console.warn(`Format Groq (${model}) échec: ${err.message}`);
//         }
//     }

//     if (data) return `Voici les données brutes :\n${JSON.stringify(data, null, 2)}`;
//     return 'Je n\'ai pas pu générer de réponse. Réessayez.';
// }

// // ------------------------------------------------------------
// // Confirme et exécute une action
// // ------------------------------------------------------------
// async function confirmAction(draft, userId) {
//     if (!draft || !draft.type) throw new Error('Action invalide.');
//     const action = ACTIONS[draft.type];
//     if (!action) throw new Error('Action inconnue : ' + draft.type);
//     const result = await action.execute(draft.payload, userId);
//     return result;
// }

// // ------------------------------------------------------------
// // Point d'entrée
// // ------------------------------------------------------------
// async function chat(userMessage, userId, conversationHistory = []) {
//     const start = Date.now();

//     const { intent, args } = await detectIntent(userMessage, conversationHistory);
//     const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);
//     const response = await formatResponse(userMessage, intent, data, conversationHistory);

//     return {
//         response,
//         intent,
//         hasData: !!data,
//         durationMs: Date.now() - start
//     };
// }



// backend/utils/assistant/orchestrator.js
// Orchestre : intention → outil → réponse naturelle

// const OpenAI = require('openai');
// const { detectIntent } = require('./assistant/router');
// const tools = require('./assistant/tools');
// const { ACTIONS } = require('./assistant/actions');
// const { calculerDevisDepuisTexte, calculerDevisMultiMetiers } = require('./assistant/metiers');

// // Initialisation du client Groq
// let groqClient = null;
// if (process.env.GROQ_API_KEY) {
//     groqClient = new OpenAI({
//         baseURL: 'https://api.groq.com/openai/v1',
//         apiKey: process.env.GROQ_API_KEY,
//     });
// }

// // Modeles Groq disponibles avec fallback
// const GROQ_MODELS = [
//     'openai/gpt-oss-20b', 
//     'openai/gpt-oss-120b'
// ];

// // ------------------------------------------------------------
// // Fallback : extrait un nom depuis un message (utilisé quand
// // l'IA n'a pas rempli le patch d'update_quote)
// // ------------------------------------------------------------
// const NAME_BLACKLIST = new Set([
//     'vincent', 'client', 'devis', 'bonjour', 'merci', 'salut', 'modifie', 'modifier',
//     'ajoute', 'ajouter', 'change', 'changer', 'mets', 'mettre', 'nom', 'dernier',
//     'premier', 'nouveau', 'ancien', 'bon', 'bonne', 'oui', 'non', 'ok', 'd accord',
//     'le', 'la', 'les', 'un', 'une', 'des', 'ce', 'cette', 'mon', 'ma', 'mes'
// ]);

// function extractFallbackName(message) {
//     if (!message || typeof message !== 'string') return null;
//     const txt = message.trim();

//     // Stratégie 1 : patterns explicites
//     const patterns = [
//         /nom\s+(?:de|du\s+client|d')\s*:?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
//         /client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
//         /(?:mettre|mets|ajoute[rz]?|rajoute[rz]?|assigner?)\s+([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60}?)\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
//         /client\s*[:=]\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i
//     ];

//     for (const re of patterns) {
//         const m = txt.match(re);
//         if (m && m[1]) {
//             let name = m[1].trim()
//                 .replace(/[.,!?;:]+$/, '')
//                 .replace(/\s+(s'il|svp|merci|please).*$/i, '')
//                 .trim();
//             name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
//             if (name.length >= 2) {
//                 console.log(`✅ [Fallback] Nom extrait (pattern) : "${name}"`);
//                 return name;
//             }
//         }
//     }

//     // Stratégie 2 : mots capitalisés consécutifs
//     const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}){0,3})\b/g;
//     const candidates = [];
//     let match;
//     while ((match = capitalPattern.exec(txt)) !== null) {
//         candidates.push(match[1]);
//     }

//     const validCandidates = candidates.filter(c => {
//         const firstWord = c.split(/\s+/)[0];
//         if (NAME_BLACKLIST.has(firstWord.toLowerCase())) return false;
//         if (c.length < 2 || c.length > 60) return false;
//         return true;
//     });

//     if (validCandidates.length > 0) {
//         validCandidates.sort((a, b) => b.length - a.length);
//         const name = validCandidates[0];
//         console.log(`✅ [Fallback] Nom extrait (capitales) : "${name}"`);
//         return name;
//     }

//     // Stratégie 3 : réponse courte (2-4 mots)
//     const words = txt.replace(/[.,!?;:]+$/, '').trim().split(/\s+/);
//     if (words.length >= 2 && words.length <= 4 && txt.length <= 40) {
//         const actionWords = /(devis|client|modifi|ajout|chang|mets|comme|nom|dernier|sur|dans|pour|avec)/i;
//         if (!actionWords.test(txt)) {
//             const name = words.join(' ');
//             const capitalized = name.replace(/\b\w/g, l => l.toUpperCase());
//             console.log(`✅ [Fallback] Nom extrait (court) : "${capitalized}"`);
//             return capitalized;
//         }
//     }

//     return null;
// }

// // ------------------------------------------------------------
// // Exécute l'intention
// // ------------------------------------------------------------
// async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
//     // Charger les préférences utilisateur
//     let userPrefs = null;
//     try {
//         const { getUserPreferences } = require('./preferences');
//         userPrefs = await getUserPreferences(userId);
//     } catch (err) {
//         console.warn('Impossible de charger les préférences:', err.message);
//     }

//     // ==========================================================
//     // FALLBACK UNIQUE pour update_quote : si pas de patch, on essaie
//     // d'extraire un nom depuis le message ou l'historique
//     // ==========================================================
//     if (intent === 'update_quote') {
//         const hasPatch = args && args.patch && typeof args.patch === 'object' && Object.keys(args.patch).length > 0;

//         if (!hasPatch) {
//             console.log('🛟 [update_quote] Aucun patch → activation du fallback');

//             let extractedName = extractFallbackName(userMessage);

//             // Regarder les derniers messages utilisateur de l'historique
//             if (!extractedName && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
//                 const lastUserMsgs = conversationHistory
//                     .filter(m => m.role === 'user')
//                     .slice(-2)
//                     .reverse();
//                 for (const msg of lastUserMsgs) {
//                     extractedName = extractFallbackName(msg.text);
//                     if (extractedName) break;
//                 }
//             }

//             // Dernier recours : si le message est très court et ne contient aucun verbe d'action
//             if (!extractedName && userMessage && userMessage.trim().length >= 3 && userMessage.trim().length <= 40) {
//                 const trimmed = userMessage.trim().replace(/[.,!?;:]+$/, '');
//                 if (!/(devis|client|modifi|ajout|chang|mets|bonjour|merci|salut|oui|non)/i.test(trimmed)) {
//                     extractedName = trimmed.replace(/\b\w/g, l => l.toUpperCase());
//                 }
//             }

//             if (extractedName) {
//                 console.log(`✅ [update_quote] Nom forcé : "${extractedName}"`);
//                 args = { ...(args || {}), patch: { clientName: extractedName } };
//             } else {
//                 console.log('❌ [update_quote] Impossible d\'extraire un nom');
//                 return {
//                     error: 'Je n\'ai pas réussi à identifier ce que vous voulez modifier. Précisez par exemple : "Ajoute Vincent Dubois comme client".'
//                 };
//             }
//         }
//     }

//     // Si c'est une action d'écriture, on prépare SANS exécuter
//     if (ACTIONS[intent]) {
//         const draft = await ACTIONS[intent].prepare(args || {}, userId);
//         return { isPendingAction: true, draft };
//     }

//     // Sinon, lecture normale
//     switch (intent) {
//         case 'list_products':  return await tools.listProducts(userId, args);
//         case 'find_product':   return await tools.findProduct(userId, args);
//         case 'list_services':  return await tools.listServices(userId, args);
//         case 'list_clients':   return await tools.listClients(userId, args);
//         case 'find_client':    return await tools.findClient(userId, args);
//         case 'list_suppliers': return await tools.listSuppliers(userId, args);
//         case 'list_quotes':    return await tools.listQuotes(userId, args);
//         case 'quote_stats':    return await tools.getQuoteStats(userId);
//         case 'list_invoices':  return await tools.listInvoices(userId, args);
//         case 'invoice_stats':  return await tools.getInvoiceStats(userId);
//         case 'stock_alerts':   return await tools.getStockAlerts(userId);
//         case 'general_stats':  return await tools.getGeneralStats(userId);

//         case 'calculer_metier':
//         case 'calculer_chantier': {
//             const { pool } = require('../../db');
//             const [productsResult, servicesResult] = await Promise.all([
//                 pool.query('SELECT ref, name, unit_price FROM products WHERE user_id = $1', [userId]),
//                 pool.query('SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE', [userId])
//             ]);
//             const products = productsResult.rows.map(p => ({
//                 ref: p.ref, name: p.name, unitPrice: parseFloat(p.unit_price)
//             }));
//             const services = servicesResult.rows.map(s => ({
//                 ref: s.ref, name: s.name, unitPrice: parseFloat(s.unit_price),
//                 unit: s.unit, isLabor: s.is_labor
//             }));

//             // Appliquer les corrections vocales si présentes
//             let description = args.description || '';
//             if (userPrefs && userPrefs.voiceCorrections) {
//                 const { applyVoiceCorrections } = require('./preferences');
//                 description = applyVoiceCorrections(description, userPrefs.voiceCorrections);
//             }

//             const result = intent === 'calculer_chantier'
//                 ? await calculerDevisMultiMetiers(description, products, services)
//                 : await calculerDevisDepuisTexte(description, products, services);

//             if (!result.success) return { error: result.error };

//             // Appliquer le taux horaire utilisateur et la marge
//             const { getHourlyRateForMetier, applyMargin } = require('./preferences');

//             if (userPrefs) {
//                 const metierName = result.metier || (result.metiers && result.metiers[0]) || null;
//                 result.items = result.items.map(item => {
//                     if (item.ref && item.ref.startsWith('MO-')) {
//                         const taux = getHourlyRateForMetier(userPrefs, metierName);
//                         item.unitPrice = taux;
//                         item.total = Math.round(item.qty * taux * 100) / 100;
//                     }
//                     return item;
//                 });

//                 if (userPrefs.defaultMarginPercent > 0) {
//                     result.items = result.items.map(item => {
//                         if (!item.ref || !item.ref.startsWith('MO-')) {
//                             item.unitPrice = applyMargin(item.unitPrice, userPrefs.defaultMarginPercent);
//                             item.total = Math.round(item.qty * item.unitPrice * 100) / 100;
//                         }
//                         return item;
//                     });
//                 }
//             }

//             const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);

//             const previewLines = {
//                 'Nombre de lignes': result.items.length,
//                 'Temps total': `${result.heures} h`,
//                 'Total HT': subtotal.toFixed(2) + ' €'
//             };

//             if (result.metier) {
//                 previewLines['Métier détecté'] = result.metier;
//                 if (result.surface) previewLines['Surface'] = `${result.surface} m²`;
//             } else if (result.metiers) {
//                 previewLines['Métiers détectés'] = result.metiers.join(', ');
//             }

//             // Réordonner : métier d'abord
//             const orderedPreview = {};
//             if (previewLines['Métier détecté']) orderedPreview['Métier détecté'] = previewLines['Métier détecté'];
//             if (previewLines['Métiers détectés']) orderedPreview['Métiers détectés'] = previewLines['Métiers détectés'];
//             if (previewLines['Surface']) orderedPreview['Surface'] = previewLines['Surface'];
//             orderedPreview['Nombre de lignes'] = previewLines['Nombre de lignes'];
//             orderedPreview['Temps total'] = previewLines['Temps total'];
//             orderedPreview['Total HT'] = previewLines['Total HT'];

//             return {
//                 isPendingAction: true,
//                 draft: {
//                     type: 'create_quote_simple',
//                     summary: `Créer un devis ${result.metier || 'chantier'} (${result.items.length} lignes, ${result.heures} h)`,
//                     preview: orderedPreview,
//                     payload: {
//                         clientName: args.clientName || 'Client à préciser',
//                         items: result.items,
//                         vatRegime: userPrefs?.defaultVatRegime || 'franchise',
//                         vatRate: userPrefs?.defaultVatRate || 21,
//                         logs: result.logs
//                     }
//                 }
//             };
//         }

//         case 'help': return { help: true };
//         case 'chat':
//         default:
//             return null;
//     }
// }

// // ------------------------------------------------------------
// // Formate la réponse
// // ------------------------------------------------------------
// async function formatResponse(userMessage, intent, data, conversationHistory = []) {
//     if (data && data.isPendingAction) {
//         const d = data.draft;
//         let previewText = '';
//         for (const [key, val] of Object.entries(d.preview)) {
//             previewText += `• ${key} : ${val}\n`;
//         }
//         return {
//             isPendingAction: true,
//             message: `Je vais effectuer l'action suivante :\n\n**${d.summary}**\n\n${previewText}\nCliquez sur Confirmer pour valider ou Annuler pour annuler.`,
//             draft: d
//         };
//     }

//     if (data && data.error) {
//         return { error: data.error };
//     }

//     if (!groqClient) {
//         if (data) return `Données :\n${JSON.stringify(data, null, 2)}`;
//         return 'L\'assistant n\'est pas disponible pour le moment.';
//     }

//     // Contexte conversationnel
//     let historyContext = '';
//     if (conversationHistory && conversationHistory.length > 0) {
//         const recent = conversationHistory.slice(-4);
//         historyContext = `\nContexte des derniers messages :\n` +
//             recent.map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.text}`).join('\n') + '\n';
//     }

//     let systemContext = '';

//     if (intent === 'help') {
//         systemContext = `Tu es l'assistant de Devis Express Pro. L'utilisateur demande de l'aide.
//         Tu peux lui expliquer ces fonctionnalités :
//         - Créer des devis (onglet Devis, upload d'un PDF/Word/Excel)
//         - Gérer le catalogue produits
//         - Gérer les services et la main d'œuvre
//         - Gérer les clients et les fournisseurs
//         - Gérer le stock (alertes, mouvements, commandes fournisseurs)
//         - Gérer les factures
//         - Gérer l'équipe (invitations, rôles)
//         - Créer des devis depuis la description d'un chantier
//         - Envoyer un devis par email
//         - Modifier un devis existant (client, adresse, email, statut, date)
//         Réponds en français, chaleureusement, de façon concise.`;
//             } else if (data) {
//                 systemContext = `Tu es l'assistant interne de Devis Express Pro.
//         L'utilisateur vient de poser cette question : "${userMessage}"

//         ⚠️ Tu as DÉJÀ interrogé la base de données de l'utilisateur et tu as les résultats ci-dessous.
//         NE DIS JAMAIS que tu n'as pas accès aux données.

//         Voici les données réelles de SA base :
//         \`\`\`json
//         ${JSON.stringify(data, null, 2)}
//         \`\`\`

//         Ta mission : formuler une réponse naturelle, claire et concise en français.
//         Règles STRICTES :
//         - Utilise uniquement les données ci-dessus, ne les invente pas.
//         - Si c'est une liste, présente-la avec des puces ou un tableau simple.
//         - Mets en avant les chiffres importants.
//         - Si le résultat est vide, dis-le poliment.
//         - Ne mets JAMAIS de JSON brut dans ta réponse.
//         - Réponds directement à la question.`;
//             } else {
//                 systemContext = `${historyContext}Tu es l'assistant conversationnel de Devis Express Pro, une application de gestion de devis, factures, stock et clients pour indépendants et TPE.
//         Réponds en français de façon naturelle, brève et chaleureuse.
//         Si l'utilisateur te salue, salue-le simplement en retour.
//         Si le contexte montre qu'on est en train de modifier un devis et qu'on attend un nom de client, guide l'utilisateur pas à pas.`;
//     }

//     for (const model of GROQ_MODELS) {
//         try {
//             const completion = await groqClient.chat.completions.create({
//                 model: model,
//                 messages: [
//                     { role: 'system', content: systemContext },
//                     { role: 'user', content: userMessage }
//                 ],
//                 temperature: 0.3,
//                 max_tokens: 1200,
//             });
//             return completion.choices[0].message.content.trim();
//         } catch (err) {
//             console.warn(`Format Groq (${model}) échec: ${err.message}`);
//         }
//     }

//     if (data) return `Voici les données brutes :\n${JSON.stringify(data, null, 2)}`;
//     return 'Je n\'ai pas pu générer de réponse. Réessayez.';
// }

// // ------------------------------------------------------------
// // Confirme et exécute une action
// // ------------------------------------------------------------
// async function confirmAction(draft, userId) {
//     if (!draft || !draft.type) throw new Error('Action invalide.');
//     const action = ACTIONS[draft.type];
//     if (!action) throw new Error('Action inconnue : ' + draft.type);
//     const result = await action.execute(draft.payload, userId);
//     return result;
// }

// // ------------------------------------------------------------
// // Point d'entrée
// // ------------------------------------------------------------
// async function chat(userMessage, userId, conversationHistory = []) {
//     const start = Date.now();

//     const { intent, args } = await detectIntent(userMessage, conversationHistory);
//     const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);
//     const response = await formatResponse(userMessage, intent, data, conversationHistory);

//     return {
//         response,
//         intent,
//         hasData: !!data,
//         durationMs: Date.now() - start
//     };
// }

//module.exports = { chat, confirmAction };