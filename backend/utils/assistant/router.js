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

// Toutes les intentions possibles
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

async function detectIntent(message) {
    if (!groqClient) return { intent: 'chat', args: {} };

    const prompt = `Tu es un routeur. Classe le message de l'utilisateur dans UNE SEULE catégorie.

Catégories possibles :
- list_products : veut voir la liste des produits
- find_product : cherche un produit précis
- list_services : veut voir la liste des services
- list_clients : veut voir la liste des clients
- find_client : cherche un client précis
- list_suppliers : veut voir la liste des fournisseurs
- list_quotes : veut voir la liste des devis
- quote_stats : veut des statistiques sur les devis (CA, conversion, etc)
- list_invoices : veut voir la liste des factures
- invoice_stats : veut des stats sur les factures (payé, en retard, etc)
- stock_alerts : demande sur le stock, les alertes, les ruptures
- general_stats : demande un résumé général, un état des lieux
- help : demande de l'aide, comment faire quelque chose
- chat : discussion générale, salutation, question hors sujet

Message : """${message}"""

Réponds UNIQUEMENT en JSON : {"intent": "nom_categorie", "args": {"query": "terme_recherche_si_applicable"}}

Ne mets AUCUN texte en dehors du JSON.`;

    try {
        const completion = await groqClient.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: 150,
        });
        let content = completion.choices[0].message.content.trim();
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(content);

        if (!INTENTS.includes(parsed.intent)) {
            return { intent: 'chat', args: {} };
        }
        return parsed;
    } catch (err) {
        console.warn('Routeur Groq échec:', err.message);
        return { intent: 'chat', args: {} };
    }
}

module.exports = { detectIntent, INTENTS };