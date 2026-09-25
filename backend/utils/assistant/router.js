// backend/utils/assistant/router.js
// Détecte l'intention de l'utilisateur via un appel Groq rapide

const OpenAI = require('openai');
const { normalizeMessage } = require('./normalizer');
const { buildSessionSummary } = require('./session');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
}

const INTENTS = [
    'list_products', 'find_product', 'list_services', 'list_clients', 'find_client',
    'list_suppliers', 'list_quotes', 'quote_stats', 'list_invoices', 'invoice_stats',
    'stock_alerts', 'general_stats',
    'create_client', 'create_product', 'create_service', 'create_supplier',
    'adjust_stock', 'create_quote_simple',
    'update_quote', 'change_quote_status', 'delete_quote', 'duplicate_quote',
    'add_items_to_quote', 'remove_item_from_quote', 'convert_quote_to_invoice',
    'mark_invoice_paid',
    'send_quote_email', 'send_invoice_email',
    'save_preference',
    'calculer_metier', 'calculer_chantier',
    'list_chantiers', 'find_chantier', 'chantier_stats',
    'help', 'chat'
];

const GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

// ------------------------------------------------------------
// Heuristique LOCALE
// ------------------------------------------------------------
function heuristicIntent(message, session = null) {
    if (!message || typeof message !== 'string') return null;
    const msg = message.trim();
    const lower = msg.toLowerCase();

    // 1. Si on attend une réponse (question en attente)
    if (session && session.context && session.context.pendingField) {
        const field = session.context.pendingField;
        const trimmed = msg.replace(/[.,!?;:]+$/, '').trim();

        if (field === 'clientName') {
            const name = trimmed.replace(/\b\w/g, l => l.toUpperCase());
            if (name.length >= 2 && name.length <= 60) {
                console.log(`🎯 [Session] Réponse à question en attente → clientName = "${name}"`);
                return { intent: 'update_quote', args: { patch: { clientName: name } } };
            }
        }
        if (field === 'clientEmail') {
            const email = trimmed.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (email) {
                return { intent: 'update_quote', args: { patch: { clientEmail: email[0] } } };
            }
        }
        if (field === 'status') {
            const map = {
                'brouillon': 'draft', 'envoyé': 'sent', 'envoye': 'sent',
                'accepté': 'accepted', 'accepte': 'accepted',
                'refusé': 'refused', 'refuse': 'refused'
            };
            const s = map[trimmed.toLowerCase()];
            if (s) return { intent: 'change_quote_status', args: { status: s } };
        }
    }

    // 2. Patterns update_quote (nom propre)
    const updatePatterns = [
        /(?:ajoute[rz]?|mets?|mettre|renomme[rz]?|modifie[rz]?|change[rz]?)\s+(?:le\s+)?(?:nom\s+(?:de\s+|du\s+client\s+)?)?([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+){0,3})\s+(?:comme|au|à|sur|dans)\s+(?:client|devis)/i,
        /(?:le\s+)?client\s*(?:c[''`]est|:)\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+){0,3})/i,
        /(?:nom\s+(?:de|du\s+client|d')\s*:?\s*)([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+(?:\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ][a-zàâéèêëîïôùûüç'’-]+){0,3})/i,
    ];
    for (const re of updatePatterns) {
        const m = msg.match(re);
        if (m && m[1]) {
            let name = m[1].trim().replace(/[.,!?;:]+$/, '')
                .replace(/\s+(s'il|svp|merci|please).*$/i, '').trim();
            name = name.replace(/^(le|la|les|un|une|des)\s+/i, '').trim();
            if (name.length >= 2) {
                return { intent: 'update_quote', args: { patch: { clientName: name } } };
            }
        }
    }

    // 3. Statut
    const statusMatch = lower.match(/(?:statut|status|passe[rz]?|marque[rz]?)\D*(brouillon|envoyé|envoye|sent|accepté|accepte|accepted|refusé|refuse|refused)/i);
    if (statusMatch) {
        const map = {
            'brouillon': 'draft', 'envoyé': 'sent', 'envoye': 'sent', 'sent': 'sent',
            'accepté': 'accepted', 'accepte': 'accepted', 'accepted': 'accepted',
            'refusé': 'refused', 'refuse': 'refused', 'refused': 'refused'
        };
        const s = map[statusMatch[1].toLowerCase()];
        if (s) return { intent: 'change_quote_status', args: { status: s } };
    }

    // 4. Envoi par email (devis)
    if (/(?:envoie[rz]?|envoyer)\s+(?:le\s+)?(?:devis|mail|email)/i.test(msg)) {
        const emailMatch = msg.match(/[\w.-]+@[\w.-]+\.\w+/);
        return { intent: 'send_quote_email', args: emailMatch ? { email: emailMatch[0] } : {} };
    }

    // 5. Envoi par email (facture)
    if (/(?:envoie[rz]?|envoyer)\s+(?:la\s+)?facture/i.test(msg)) {
        const emailMatch = msg.match(/[\w.-]+@[\w.-]+\.\w+/);
        return { intent: 'send_invoice_email', args: emailMatch ? { email: emailMatch[0] } : {} };
    }

    // 6. Suppression
    if (/(?:supprime[rz]?|efface[rz]?)\s+(?:le\s+)?(?:dernier|premier|avant-dernier)?\s*devis/i.test(msg)) {
        return { intent: 'delete_quote', args: {} };
    }

    // 7. Duplication
    if (/(?:duplique[rz]?|copie[rz]?|clone[rz]?)\s+(?:le\s+)?(?:dernier\s+)?devis/i.test(msg)) {
        return { intent: 'duplicate_quote', args: {} };
    }

    // 8. Transformation en facture
    if (/(?:transforme[rz]?|converti[rz]?|fais\s+une\s+facture|crée[rz]?\s+une\s+facture)/i.test(msg)
        && /devis/i.test(msg)) {
        return { intent: 'convert_quote_to_invoice', args: {} };
    }

    // 9. Marquer facture payée
    if (/(?:marque[rz]?|facture\s+payée?|paiement\s+reçu)/i.test(msg) && /facture/i.test(msg)) {
        const invNum = msg.match(/([A-Z]{2,}-\d{3,4}-\d{4})/i);
        return { intent: 'mark_invoice_paid', args: invNum ? { invoiceNumber: invNum[1] } : {} };
    }

    // 10. Ajouter un article à un devis
    const addItemMatch = msg.match(/(?:ajoute[rz]?|rajoute[rz]?)\s+(.+?)\s+(?:au|sur|dans)\s+(?:le\s+)?devis/i);
    if (addItemMatch) {
        const itemDesc = addItemMatch[1].trim();
        const qtyPriceMatch = itemDesc.match(/^(\d+)\s*(?:x\s*)?(.+?)(?:\s+à\s+(\d+(?:[.,]\d+)?)\s*€?)?$/i);
        let items = [];
        if (qtyPriceMatch) {
            items = [{
                qty: parseInt(qtyPriceMatch[1]) || 1,
                name: qtyPriceMatch[2].trim(),
                unitPrice: parseFloat(String(qtyPriceMatch[3] || '0').replace(',', '.'))
            }];
        } else {
            items = [{ qty: 1, name: itemDesc, unitPrice: 0 }];
        }
        return { intent: 'add_items_to_quote', args: { items } };
    }

    // 11. Retirer un article d'un devis
    const removeItemMatch = msg.match(/(?:retire[rz]?|enlève[rz]?|supprime[rz]?)\s+(.+?)\s+(?:du|de\s+la|dans\s+le)\s+devis/i);
    if (removeItemMatch) {
        return { intent: 'remove_item_from_quote', args: { itemName: removeItemMatch[1].trim() } };
    }

    // 12. Salutations simples
    if (/^(bonjour|salut|hello|hi|coucou|bonsoir)[\s!.,?]*$/i.test(msg)) {
        return { intent: 'chat', args: {} };
    }

    return null;
}

// ------------------------------------------------------------
// Détecte l'intention
// ------------------------------------------------------------
async function detectIntent(message, conversationHistory = [], userId = null) {
    // 1. Normaliser le message (nombres, corrections, langue, dates)
    let userPrefs = null;
    if (userId) {
        try {
            const { getUserPreferences } = require('./preferences');
            userPrefs = await getUserPreferences(userId);
        } catch (e) { /* silencieux */ }
    }
    const normalized = normalizeMessage(message, userPrefs);
    const cleanMessage = normalized.text;
    const detectedLang = normalized.lang;

    // 2. Charger la session
    let session = null;
    if (userId) {
        try {
            const { getSession } = require('./session');
            session = await getSession(userId);
        } catch (e) { /* silencieux */ }
    }

    // 3. Heuristique locale
    const heuristic = heuristicIntent(cleanMessage, session);
    if (heuristic) {
        console.log(`🎯 [Heuristique/${detectedLang}] ${heuristic.intent}`, JSON.stringify(heuristic.args).slice(0, 100));
        return heuristic;
    }

    if (!groqClient) {
        console.warn('Routeur: pas de client Groq, fallback chat');
        return { intent: 'chat', args: {} };
    }

    // 4. Contexte conversationnel
    let contextBlock = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recent = conversationHistory.slice(-3);
        contextBlock += recent.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${(m.text || '').slice(0, 100)}`).join('\n');
        contextBlock = `\nContexte récent:\n${contextBlock}\n`;
    }

    // 5. Session summary
    let sessionBlock = '';
    if (session) {
        const summary = buildSessionSummary(session);
        if (summary) sessionBlock = `\n${summary}\n`;
    }

    // 6. Langue → indication pour le prompt
    const langHint = detectedLang === 'nl'
        ? '\n⚠️ L\'utilisateur parle en NÉERLANDAIS. Utilise les mêmes catégories mais tiens compte des mots NL (offerte, klant, factuur...).\n'
        : detectedLang === 'en'
        ? '\n⚠️ L\'utilisateur parle en ANGLAIS. Utilise les mêmes catégories.\n'
        : '';

    const prompt = `Tu es un routeur d'intentions pour une application de devis/factures/stock.
        Réponds UNIQUEMENT avec un JSON strict. Aucun texte avant/après.
        ${contextBlock}${sessionBlock}${langHint}
        Catégories possibles :
        - list_products, find_product, list_services, list_clients, find_client
        - list_suppliers, list_quotes, quote_stats, list_invoices, invoice_stats
        - stock_alerts, general_stats
        - create_client, create_product, create_service, create_supplier, adjust_stock
        - create_quote_simple (créer un NOUVEAU devis à partir d'items dictés)
        - update_quote (modifier un devis EXISTANT : client, adresse, email, statut, date)
        - change_quote_status (changer le statut : brouillon, envoyé, accepté, refusé)
        - delete_quote (supprimer un devis)
        - duplicate_quote (dupliquer un devis)
        - convert_quote_to_invoice (transformer un devis en facture)
        - mark_invoice_paid (marquer une facture payée)
        - send_quote_email (envoyer un devis par email)
        - send_invoice_email (envoyer une facture par email)
        - add_items_to_quote (ajouter des lignes à un devis existant)
        - remove_item_from_quote (retirer une ligne d'un devis)
        - calculer_metier (UN seul métier avec dimensions)
        - calculer_chantier (PLUSIEURS métiers dans la même phrase)
        - save_preference (mémoriser taux horaire, marge, TVA, conditions de paiement)
        - list_chantiers : veut voir la liste des chantiers
        - find_chantier : cherche un chantier précis
        - chantier_stats : veut des statistiques sur les chantiers
        - help, chat

        ━━━ RÈGLES ━━━
        - "Mes chantiers", "liste des chantiers" → list_chantiers
        - "Où en est le chantier X", "cherche le chantier X" → find_chantier
        - "Combien de chantiers", "stats chantiers", "état des chantiers" → chantier_stats

        ━━━ Impératifs ━━━ 
        dans une réponse:
        Tu ne dois pas lire les ponctuations et les characteres speciaux dans une reponse du genre {/*-+:.|@[]!()}, sauf en cas de cas de calcul
        Les champs indiqués par « – », « –----- », |----| et « / » sont vides (tu ne dois pas les lires ou les cités, sauf en cas de calcul).
        Les champs indiqués par "|---|---------------------|---------|-------|-----------|-----|", ne doivent pas etre cité et lu, cela représente le tableau visuel.

        ━━━ RÈGLES CRITIQUES POUR update_quote ━━━
        1. DÉCLENCHE update_quote dès que l'utilisateur veut MODIFIER un devis existant.
        2. TU DOIS TOUJOURS remplir "patch" avec AU MOINS UN champ.
        3. Extraction du nom : "Vincent Dubois" → patch.clientName = "Vincent Dubois"
        4. Statuts : envoyé → "sent", accepté → "accepted", refusé → "refused", brouillon → "draft"
        5. Dates : patch.validDate au format "YYYY-MM-DD"
        6. Adresse : patch.clientAddress
        7. Email : patch.clientEmail
        8. TVA : patch.clientVat

        ━━━ EXEMPLES ━━━
        "Ajoute le nom de Vincent Dubois" → {"intent":"update_quote","args":{"patch":{"clientName":"Vincent Dubois"}}}
        "Mets Dupont SARL comme client" → {"intent":"update_quote","args":{"patch":{"clientName":"Dupont SARL"}}}
        "Le client c'est Marie Leroy" → {"intent":"update_quote","args":{"patch":{"clientName":"Marie Leroy"}}}
        "Change le statut en envoyé" → {"intent":"change_quote_status","args":{"status":"sent"}}
        "Modifie la date de validité au 31/12/2026" → {"intent":"update_quote","args":{"patch":{"validDate":"2026-12-31"}}}
        "Ajoute l'adresse 12 rue de la Paix" → {"intent":"update_quote","args":{"patch":{"clientAddress":"12 rue de la Paix"}}}
        "Envoie le dernier devis par email à client@test.com" → {"intent":"send_quote_email","args":{"email":"client@test.com"}}
        "Fais-moi un devis pour peindre 5 murs de 3m x 2.5m" → {"intent":"calculer_metier","args":{"description":"peindre 5 murs de 3m x 2.5m"}}
        "Chantier rénovation salle de bain : carrelage 3x2.5, plomberie, peinture" → {"intent":"calculer_chantier","args":{"description":"rénovation salle de bain : carrelage 3x2.5, plomberie, peinture"}}
        "Mon taux horaire par défaut c'est 50€" → {"intent":"save_preference","args":{"preference":"taux horaire","value":"50"}}
        "Passe le devis en envoyé" → {"intent":"change_quote_status","args":{"status":"sent"}}
        "Supprime le dernier devis" → {"intent":"delete_quote","args":{}}
        "Duplique le dernier devis" → {"intent":"duplicate_quote","args":{}}
        "Transforme le devis accepté en facture" → {"intent":"convert_quote_to_invoice","args":{}}
        "Marque la facture FAC-0015-2026 payée" → {"intent":"mark_invoice_paid","args":{"invoiceNumber":"FAC-0015-2026"}}
        "Envoie la facture à client@test.com" → {"intent":"send_invoice_email","args":{"email":"client@test.com"}}
        "Ajoute 2 câbles HDMI à 8.90€ au dernier devis" → {"intent":"add_items_to_quote","args":{"items":[{"qty":2,"name":"câble HDMI","unitPrice":8.90}]}}
        "Retire la peinture du devis" → {"intent":"remove_item_from_quote","args":{"itemName":"peinture"}}

        ━━━ RÉFÉRENCES RELATIVES ━━━
        "le dernier devis" → args.quoteRef = "dernier" (ou rien du tout, défaut = dernier)
        "l'avant-dernier devis" → args.quoteRef = "avant-dernier"
        "le premier devis" → args.quoteRef = "premier"
        "le 3e devis" → args.quoteRef = "3"
        Le routeur peut ajouter "quoteRef" dans args pour préciser.

        ━━━ CONTEXTE CONVERSATIONNEL ━━━
        Si l'assistant a posé une question et que l'utilisateur répond brièvement, c'est un follow-up.

        Message : "${String(cleanMessage).slice(0, 500)}"

        Réponds maintenant avec le JSON :`;

    let lastError = null;
    for (const model of GROQ_MODELS) {
        try {
            const completion = await groqClient.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 500,
                response_format: { type: 'json_object' },
            });

            let content = completion.choices[0].message.content;
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();

            const start = content.indexOf('{');
            const end = content.lastIndexOf('}');
            if (start === -1 || end === -1) throw new Error('Pas de JSON trouvé');

            const parsed = JSON.parse(content.substring(start, end + 1));

            if (!INTENTS.includes(parsed.intent)) {
                console.warn(`Routeur: intention inconnue "${parsed.intent}", fallback chat`);
                return { intent: 'chat', args: {} };
            }

            if (parsed.intent === 'update_quote') {
                const hasPatch = parsed.args && parsed.args.patch && Object.keys(parsed.args.patch).length > 0;
                if (!hasPatch) {
                    console.warn('Routeur: update_quote sans patch → fallback chat');
                    return { intent: 'chat', args: {} };
                }
            }

            console.log(`🎯 Routeur[${detectedLang}]: ${parsed.intent}`, JSON.stringify(parsed.args || {}).slice(0, 120));
            return { intent: parsed.intent, args: parsed.args || {} };
        } catch (err) {
            console.warn(`Routeur (${model}) échec: ${err.message.slice(0, 100)}`);
            lastError = err;
        }
    }

    console.warn('Routeur: tous les modèles ont échoué, fallback chat.');
    return { intent: 'chat', args: {} };
}

module.exports = { detectIntent, INTENTS, heuristicIntent };