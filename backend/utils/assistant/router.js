// backend/utils/assistant/router.js
// Détecte l'intention de l'utilisateur via un appel Groq rapide

const OpenAI = require('openai');

let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
}

const INTENTS = [
    'list_products',
    'find_product',
    'list_services',
    'list_clients',
    'find_client',
    'list_suppliers',
    'list_quotes',
    'quote_stats',
    'list_invoices',
    'invoice_stats',
    'stock_alerts',
    'general_stats',
    'help',
    'chat'
];

// Modèles qui existent réellement sur Groq (à jour sept. 2026)
const GROQ_MODELS = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
];

// Extrait le JSON d'une réponse même si elle contient du texte autour
function extractJSON(text) {
    if (!text) throw new Error('Réponse vide');
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Pas de JSON trouvé');
    const jsonStr = cleaned.substring(start, end + 1);
    return JSON.parse(jsonStr);
}

async function detectIntent(message) {
    if (!groqClient) {
        console.warn('Routeur: pas de client Groq, fallback chat');
        return { intent: 'chat', args: {} };
    }

    const prompt = `Tu es un routeur de messages pour une application de gestion de devis.

Classe le message ci-dessous dans UNE SEULE catégorie parmi cette liste :
list_products, find_product, list_services, list_clients, find_client, list_suppliers, list_quotes, quote_stats, list_invoices, invoice_stats, stock_alerts, general_stats, help, chat

Règles :
- "Combien de produits", "mes produits", "catalogue" → list_products
- "Cherche un produit X", "trouve X" → find_product
- "Mes services", "prestations" → list_services
- "Mes clients", "liste clients" → list_clients
- "Cherche le client X" → find_client
- "Mes fournisseurs" → list_suppliers
- "Mes devis", "liste devis" → list_quotes
- "Chiffre d'affaires", "stats devis", "taux de conversion" → quote_stats
- "Mes factures" → list_invoices
- "Factures payées", "impayés", "retard" → invoice_stats
- "Stock", "alerte stock", "rupture" → stock_alerts
- "Résumé", "vue d'ensemble", "activité" → general_stats
- "Comment faire", "aide" → help
- Sinon → chat

Message : """${message}"""

Réponds UNIQUEMENT avec ce JSON (aucun autre texte) :
{"intent":"nom_categorie","args":{"query":"terme_recherche_ou_vide"}}`;

    let lastError = null;
    for (const model of GROQ_MODELS) {
        try {
            const completion = await groqClient.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 500, // Augmenté (le modèle "réfléchit" avant de répondre)
                response_format: { type: 'json_object' }, // Force une réponse JSON valide
            });
            const content = completion.choices[0].message.content;
            const parsed = extractJSON(content);

            if (!INTENTS.includes(parsed.intent)) {
                return { intent: 'chat', args: {} };
            }
            return {
                intent: parsed.intent,
                args: parsed.args || {}
            };
        } catch (err) {
            console.warn(`Routeur Groq (${model}) échec: ${err.message}`);
            lastError = err;
        }
    }

    console.warn('Routeur Groq: tous les modèles ont échoué, fallback chat.');
    return { intent: 'chat', args: {} };
}

module.exports = { detectIntent, INTENTS };