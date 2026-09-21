// backend/utils/assistant/orchestrator.js
// Orchestre : intention → outil → réponse naturelle

const OpenAI = require('openai');
const { detectIntent } = require('./router');
const tools = require('./tools');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
}

const GROQ_MODELS = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
];

// ------------------------------------------------------------
// Appelle l'outil correspondant à l'intention
// ------------------------------------------------------------
async function executeIntent(intent, args, userId) {
    switch (intent) {
        case 'list_products':    return await tools.listProducts(userId, args);
        case 'find_product':     return await tools.findProduct(userId, args);
        case 'list_services':    return await tools.listServices(userId, args);
        case 'list_clients':     return await tools.listClients(userId, args);
        case 'find_client':      return await tools.findClient(userId, args);
        case 'list_suppliers':   return await tools.listSuppliers(userId, args);
        case 'list_quotes':      return await tools.listQuotes(userId, args);
        case 'quote_stats':      return await tools.getQuoteStats(userId);
        case 'list_invoices':    return await tools.listInvoices(userId, args);
        case 'invoice_stats':    return await tools.getInvoiceStats(userId);
        case 'stock_alerts':     return await tools.getStockAlerts(userId);
        case 'general_stats':    return await tools.getGeneralStats(userId);
        case 'help':             return { help: true };
        case 'chat':
        default:
            return null;
    }
}

// ------------------------------------------------------------
// Formate la réponse en langage naturel via Groq
// ------------------------------------------------------------
async function formatResponse(userMessage, intent, data) {
    if (!groqClient) {
        if (data) return `Données :\n${JSON.stringify(data, null, 2)}`;
        return 'L\'assistant n\'est pas disponible pour le moment.';
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
Réponds en français, chaleureusement, de façon concise.`;
    } else if (data) {
        // ⚠️ CONTEXTE CRUCIAL : dire à l'IA qu'elle A DÉJÀ les données
        systemContext = `Tu es l'assistant interne de Devis Express Pro.
L'utilisateur vient de poser cette question : "${userMessage}"

⚠️ Tu as DÉJÀ interrogé la base de données de l'utilisateur et tu as les résultats ci-dessous.
NE DIS JAMAIS que tu n'as pas accès aux données. Tu les as.

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
- Ne dis JAMAIS "je n'ai pas accès à vos données" — tu les as déjà.
- Réponds directement à la question.`;
    } else {
        systemContext = `Tu es l'assistant conversationnel de Devis Express Pro, une application de gestion de devis, factures, stock et clients pour indépendants et TPE.
Réponds en français de façon naturelle, brève et chaleureuse.
Si l'utilisateur te salue, salue-le simplement en retour.`;
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
            console.log(`✅ Assistant: réponse via ${model}`);
            return completion.choices[0].message.content.trim();
        } catch (err) {
            console.warn(`Format Groq (${model}) échec: ${err.message}`);
            lastError = err;
        }
    }

    console.warn('Format Groq: tous les modèles ont échoué.');
    if (data) return `Voici les données brutes :\n${JSON.stringify(data, null, 2)}`;
    return 'Je n\'ai pas pu générer de réponse. Réessayez.';
}

// ------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------
async function chat(userMessage, userId) {
    const start = Date.now();

    // 1. Routeur
    const { intent, args } = await detectIntent(userMessage);

    // 2. Exécution
    const data = await executeIntent(intent, args || {}, userId);

    // 3. Formatage
    const response = await formatResponse(userMessage, intent, data);

    return {
        response,
        intent,
        hasData: !!data,
        durationMs: Date.now() - start
    };
}

module.exports = { chat };