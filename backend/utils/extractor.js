/*
 * ============================================================
 * extractor.js - Moteur d'extraction IA pour devis
 * ============================================================
 * Ce fichier fait appel à plusieurs IA (Groq, KeylessAI)
 * pour extraire les articles d'un texte. Si toutes échouent,
 * il utilise le catalogue local (price-db.json) comme fallback.
 */

// On importe le catalogue de produits depuis le fichier JSON
const { products } = require('../data/price-db.json');

console.log(`Catalogue chargé : ${products.length} produits disponibles.`);

// ============================================================
// 1. CONNEXION AUX SERVICES IA
// ============================================================

let groqClient = null;
let openRouterClient = null;

try {
    const OpenAI = require('openai');

    // Groq (prioritaire)
    if (process.env.GROQ_API_KEY) {
        groqClient = new OpenAI({
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: process.env.GROQ_API_KEY,
        });
        console.log('Groq connecté (prioritaire).');
    } else {
        console.log('ℹGROQ_API_KEY absente.');
    }

    // OpenRouter (fallback optionnel)
    if (process.env.OPENROUTER_API_KEY) {
        openRouterClient = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: process.env.OPENROUTER_API_KEY,
        });
        console.log('OpenRouter connecté (fallback).');
    }
} catch (e) {
    console.log('SDK OpenAI non chargé.');
}

// ============================================================
// 2. FONCTION : Extrait le JSON d'une réponse brute
// ============================================================

function extraireJSON(donneeBrute) {
    // Supprime les marqueurs de code (```json ... ```)
    let nettoye = donneeBrute.replace(/```json/g, '').replace(/```/g, '').trim();
    // Trouve le premier '[' et le dernier ']'
    const debut = nettoye.indexOf('[');
    const fin = nettoye.lastIndexOf(']');
    if (debut === -1 || fin === -1 || fin < debut) {
        throw new Error('Aucun JSON valide trouvé.');
    }
    const jsonStr = nettoye.substring(debut, fin + 1);
    return JSON.parse(jsonStr);
}

// ============================================================
// 3. APPELS AUX DIFFÉRENTS FOURNISSEURS IA
// ============================================================

// 3.1 - GROQ (avec fallback sur 3 modèles valides)
async function appelerGroq(prompt) {
    if (!groqClient) throw new Error('Groq non initialisé');

    // Modèles disponibles GRATUITEMENT sur Groq (vérifiés)
    const modeles = [
        'llama-3.3-70b-versatile',
        'openai/gpt-oss-20b',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
    ];

    let derniereErreur = null;
    for (const modele of modeles) {
        try {
            const reponse = await groqClient.chat.completions.create({
                model: modele,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 1200,
            });
            const contenu = reponse.choices[0].message.content;
            console.log(`Groq a répondu avec le modèle: ${modele}`);
            return extraireJSON(contenu);
        } catch (err) {
            console.warn(`Groq (${modele}) a échoué: ${err.message}`);
            derniereErreur = err;
        }
    }
    throw derniereErreur || new Error('Tous les modèles Groq ont échoué');
}

// 3.2 - KeylessAI (gratuit, sans clé, mais peut être instable)
async function appelerKeylessAI(prompt) {
    // Timeout de 15 secondes pour éviter de bloquer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch('https://keylessai.thryx.workers.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 1200,
            }),
        });
        clearTimeout(timeout);
        if (!response.ok) {
            throw new Error(`KeylessAI error: ${response.status}`);
        }
        const data = await response.json();
        const contenu = data.choices[0].message.content;
        return extraireJSON(contenu);
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// 3.3 - OpenRouter (fallback si tu as une clé)
async function appelerOpenRouter(prompt) {
    if (!openRouterClient) throw new Error('OpenRouter non initialisé');
    const reponse = await openRouterClient.chat.completions.create({
        model: 'google/gemini-2.0-flash-lite-preview-02-05:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1200,
    });
    const contenu = reponse.choices[0].message.content;
    return extraireJSON(contenu);
}

// ============================================================
// 4. FALLBACK LOCAL (utilise TON catalogue JSON)
// ============================================================

function fallbackLocal(texte, logs) {
    logs.push('📌 [Fallback] Recherche dans le catalogue local (price-db.json).');
    const resultats = [];
    const texteMinuscule = texte.toLowerCase();

    // Parcours de chaque produit du catalogue
    products.forEach(produit => {
        const nom = produit.name.toLowerCase();
        const ref = produit.ref.toLowerCase();
        // On vérifie si le nom ou la référence apparaît dans le texte
        if (texteMinuscule.includes(nom) || texteMinuscule.includes(ref)) {
            // Estimation de la quantité (1 par défaut, ou on cherche un nombre avant le nom)
            let qty = 1;
            // On tente de trouver un nombre juste avant le nom du produit
            const regex = new RegExp(`(\\d+)\\s*(?:x|unités?|pièces?|articles?)?\\s*${produit.name}`, 'i');
            const match = texte.match(regex);
            if (match) {
                qty = parseInt(match[1]);
            }
            resultats.push({
                ref: produit.ref,
                name: produit.name,
                qty: qty,
                unitPrice: produit.unitPrice,
                total: qty * produit.unitPrice,
            });
            logs.push(`🔎 [Fallback] "${produit.name}" trouvé → ${qty} unités.`);
        }
    });

    // Si aucun produit du catalogue n'est trouvé, on utilise le premier produit du catalogue par défaut
    if (resultats.length === 0 && products.length > 0) {
        const premier = products[0];
        resultats.push({
            ref: premier.ref,
            name: premier.name,
            qty: 2,
            unitPrice: premier.unitPrice,
            total: 2 * premier.unitPrice,
        });
        logs.push(`[Fallback] Aucun produit trouvé, ajout de "${premier.name}" par défaut.`);
    }

    return resultats;
}

// ============================================================
// 5. FONCTION DE MISE EN CORRESPONDANCE (Match)
// ============================================================

function faireCorrespondance(articlesExtraits, logs, nomProvider) {
    if (!Array.isArray(articlesExtraits) || articlesExtraits.length === 0) {
        logs.push(`${nomProvider} n'a retourné aucun article.`);
        return null;
    }

    logs.push(`${nomProvider} a extrait ${articlesExtraits.length} articles.`);
    const resultats = articlesExtraits.map(art => {
        // Recherche dans le catalogue local
        const produit = products.find(p =>
            p.ref === art.ref ||
            p.name.toLowerCase().includes(art.name.toLowerCase()) ||
            art.name.toLowerCase().includes(p.name.toLowerCase())
        );

        if (produit) {
            logs.push(`🔗 [Match] "${art.name}" → ${produit.ref} (${produit.unitPrice}€/u)`);
            return {
                ref: produit.ref,
                name: produit.name,
                qty: Math.max(1, parseInt(art.qty) || 1),
                unitPrice: produit.unitPrice,
                total: Math.max(1, parseInt(art.qty) || 1) * produit.unitPrice,
            };
        } else {
            // Si le produit n'est pas dans le catalogue, on utilise le prix proposé par l'IA
            let prixUnitaire = art.unitPrice || art.price || art.prix || 0;
            if (prixUnitaire === 0 || isNaN(prixUnitaire)) {
                prixUnitaire = 15.00; // Prix par défaut
                logs.push(`📌 [Défaut] "${art.name}" non trouvé, prix 15.00€/u`);
            } else {
                logs.push(`[Document] "${art.name}" prix lu: ${prixUnitaire}€/u`);
            }
            return {
                ref: art.ref || 'EXT-' + String(Math.random()).slice(2, 6),
                name: art.name || 'Article sans nom',
                qty: Math.max(1, parseInt(art.qty) || 1),
                unitPrice: parseFloat(prixUnitaire),
                total: Math.max(1, parseInt(art.qty) || 1) * parseFloat(prixUnitaire),
            };
        }
    });
    return resultats;
}

// ============================================================
// 6. ORCHESTRATEUR PRINCIPAL (appelé par server.js)
// ============================================================

async function extractItemsFromText(texte) {
    const logs = [];

    // Prompt envoyé à l'IA
    const prompt = `
    Tu es un assistant expert en extraction de données pour devis.
    Voici le texte d'une demande client :
    """${texte.slice(0, 3000)}"""
    
    Extrais les articles demandés au format JSON strict.
    Format : [{"ref":"string","name":"string","qty":number,"unitPrice":number}]
    
    Règles :
    - Si un prix unitaire est mentionné dans le texte, utilise-le.
    - Si le prix n'est pas mentionné, mets "unitPrice": 0.
    - Si aucune référence n'est donnée, invente une réf commençant par "EXT".
    - Ne réponds que le JSON, sans texte additionnel.`;

    // Liste des providers (ordre : Groq → KeylessAI → OpenRouter)
    const providers = [
        { nom: 'Groq', fonction: appelerGroq, disponible: !!groqClient },
        { nom: 'KeylessAI', fonction: appelerKeylessAI, disponible: true },
        { nom: 'OpenRouter', fonction: appelerOpenRouter, disponible: !!openRouterClient },
    ];

    let articlesFinaux = null;

    // Tentative avec chaque provider
    for (const provider of providers) {
        if (!provider.disponible) continue;
        try {
            logs.push(`[${provider.nom}] Tentative...`);
            const extraits = await provider.fonction(prompt);
            const correspondance = faireCorrespondance(extraits, logs, provider.nom);
            if (correspondance && correspondance.length > 0) {
                articlesFinaux = correspondance;
                logs.push(`[${provider.nom}] Succès !`);
                break;
            }
        } catch (err) {
            logs.push(`[${provider.nom}] Échec: ${err.message}`);
        }
    }

    // Si aucun provider n'a marché, on utilise le fallback local (ton catalogue JSON)
    if (!articlesFinaux) {
        logs.push('Tous les providers ont échoué, passage en fallback local.');
        articlesFinaux = fallbackLocal(texte, logs);
    }

    // Calcul du total
    const total = articlesFinaux.reduce((sum, item) => sum + item.total, 0);
    logs.push(`Total: ${total.toFixed(2)} €`);

    return { items: articlesFinaux, logs };
}

module.exports = { extractItemsFromText };