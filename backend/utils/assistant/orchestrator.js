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
        // Fallback : réponse brute JSON
        return `Voici les données :\n${JSON.stringify(data, null, 2)}`;
    }

    let systemContext = '';
    if (intent === 'help') {
        systemContext = `L'utilisateur demande de l'aide. Tu peux lui expliquer les fonctionnalités disponibles : consulter le catalogue, les clients, les services, les fournisseurs, les devis, les factures, le stock. Tu peux aussi répondre à des questions générales sur l'application. Réponds en français, de façon claire et chaleureuse.`;
    } else if (data) {
        systemContext = `Tu es un assistant pour une application de gestion de devis.
        L'utilisateur a demandé : "${userMessage}"

        Voici les données réelles retournées par la base de données :
        \`\`\`json
        ${JSON.stringify(data, null, 2)}
        \`\`\`

        Formule une réponse naturelle, concise et utile en français. 
        - Si c'est une liste, présente-la de manière lisible (avec des puces ou un tableau simple si pertinent).
        - Mets en avant les chiffres importants.
        - Ne réinvente pas les données. Utilise uniquement ce qui est fourni.
        - Si le résultat est vide, dis-le poliment.
        - Ne mets pas de JSON dans ta réponse.`;
    } else {
        systemContext = `Tu es un assistant conversationnel pour une application de gestion de devis. Réponds en français de façon utile et chaleureuse.`;
    }

    const models = [
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'llama-3.1-8b-instant',
        'llama3-70b-8192',
        'gemma2-9b-it',
    ];

    let lastError = null;
    for (const model of models) {
        try {
            const completion = await groqClient.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemContext },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 800,
            });
            console.log(`✅ Assistant: réponse via ${model}`);
            return completion.choices[0].message.content.trim();
        } catch (err) {
            console.warn(`Format Groq (${model}) échec: ${err.message}`);
            lastError = err;
        }
    }
    console.warn('Format Groq: tous les modèles ont échoué.');
    if (data) return `Données : ${JSON.stringify(data)}`;
    return 'Je n\'ai pas pu générer de réponse. Réessayez.';
}

// ------------------------------------------------------------
// Point d'entrée : reçoit le message, renvoie la réponse
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