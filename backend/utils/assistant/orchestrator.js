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

const GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

// ------------------------------------------------------------
// Fallback : extrait un nom depuis un message
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

    const patterns = [
        /nom\s+(?:de|du\s+client|d')\s*:?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i,
        /(?:mettre|mets|ajoute[rz]?|rajoute[rz]?|assigner?)\s+([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60}?)\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
        /client\s*[:=]\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇa-zàâéèêëîïôùûüç' -]{2,60})/i
    ];

    for (const re of patterns) {
        const m = txt.match(re);
        if (m && m[1]) {
            let name = m[1].trim().replace(/[.,!?;:]+$/, '')
                .replace(/\s+(s'il|svp|merci|please).*$/i, '').trim();
            name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
            if (name.length >= 2) return name;
        }
    }

    const capitalPattern = /\b([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüçA-ZÀÂÉÈÊËÎÏÔÙÛÜÇ'’-]{1,}){0,3})\b/g;
    const candidates = [];
    let match;
    while ((match = capitalPattern.exec(txt)) !== null) candidates.push(match[1]);

    const validCandidates = candidates.filter(c => {
        const firstWord = c.split(/\s+/)[0];
        if (NAME_BLACKLIST.has(firstWord.toLowerCase())) return false;
        if (c.length < 2 || c.length > 60) return false;
        return true;
    });

    if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => b.length - a.length);
        return validCandidates[0];
    }

    const words = txt.replace(/[.,!?;:]+$/, '').trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && txt.length <= 40) {
        const actionWords = /(devis|client|modifi|ajout|chang|mets|comme|nom|dernier|sur|dans|pour|avec)/i;
        if (!actionWords.test(txt)) {
            return words.join(' ').replace(/\b\w/g, l => l.toUpperCase());
        }
    }

    return null;
}

// ------------------------------------------------------------
// Exécute l'intention
// ------------------------------------------------------------
async function executeIntent(intent, args, userId, userMessage = '', conversationHistory = []) {
    let userPrefs = null;
    try {
        const { getUserPreferences } = require('./preferences');
        userPrefs = await getUserPreferences(userId);
    } catch (err) { /* silencieux */ }

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

    let historyContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recent = conversationHistory.slice(-4);
        historyContext = `\nContexte des derniers messages :\n` +
            recent.map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.text}`).join('\n') + '\n';
    }

    let systemContext = '';

    if (intent === 'help') {
        systemContext = `Tu es l'assistant de Devis Express Pro. Réponds en français, chaleureusement, de façon concise.`;
    } else if (data) {
        systemContext = `Tu es l'assistant interne de Devis Express Pro.
L'utilisateur vient de poser cette question : "${userMessage}"
⚠️ Tu as DÉJÀ interrogé la base et tu as les résultats ci-dessous.
Voici les données réelles :
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`
Formule une réponse naturelle en français. Utilise uniquement les données. Pas de JSON brut.`;
    } else {
        systemContext = `${historyContext}Tu es l'assistant conversationnel de Devis Express Pro. Réponds en français, brièvement.`;
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
// Confirme et exécute une action, met à jour la session
// ------------------------------------------------------------
async function confirmAction(draft, userId) {
    if (!draft || !draft.type) throw new Error('Action invalide.');
    const action = ACTIONS[draft.type];
    if (!action) throw new Error('Action inconnue : ' + draft.type);
    const result = await action.execute(draft.payload, userId);

    // 🆕 Mettre à jour la session après exécution
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
async function chat(userMessage, userId, conversationHistory = []) {
    const start = Date.now();

    // Enregistrer le message utilisateur dans l'historique de session
    try {
        await recordExchange(userId, 'user', userMessage);
    } catch (e) { /* silencieux */ }

    const { intent, args } = await detectIntent(userMessage, conversationHistory, userId);
    const data = await executeIntent(intent, args || {}, userId, userMessage, conversationHistory);
    const response = await formatResponse(userMessage, intent, data, conversationHistory);

    // 🆕 Sécurité : si response n'est pas une string, on la force
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