// backend/utils/vision/analyzer.js
// Analyse d'images via IA (Groq -> Gemini -> OpenAI en cascade)

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const OpenAI = require('openai');

// ------------------------------------------------------------------
// Prompt systeme commun pour toutes les IA
// ------------------------------------------------------------------
function buildPrompt(userPrompt, productsCatalog) {
    const catalogText = productsCatalog && productsCatalog.length > 0
        ? productsCatalog.slice(0, 50).map(p =>
            '- ' + (p.ref || '') + ' | ' + p.name + ' | ' + p.unitPrice + ' EUR/' + (p.unit || 'u')
        ).join('\n')
        : '(aucun produit dans le catalogue)';

    const userRequest = userPrompt && userPrompt.trim()
        ? userPrompt.trim()
        : 'Analyse cette image et extrait toutes les informations utiles pour créer un devis.';

    return `Tu es un assistant specialise dans l'analyse d'images pour le batiment et la renovation.

DEMANDE DE L'UTILISATEUR :
"""${userRequest}"""

CATALOGUE PRODUITS DISPONIBLES :
${catalogText}

Analyse l'image et reponds en JSON strict avec cette structure :
{
  "description": "Description concise de ce que tu vois (2-3 phrases)",
  "detectedType": "chantier" ou "plan" ou "facture" ou "document" ou "autre",
  "dimensions": [
    { "label": "Piece 1", "length": 4.5, "width": 3.2, "unit": "m" }
  ],
  "materials": [
    { "name": "Peinture acrylique blanche", "estimatedQty": 15, "unit": "L", "ref": null, "unitPrice": 0 }
  ],
  "extractedText": "Texte lisible dans l'image (factures, plans manuscrits, etc.)",
  "notes": "Observations supplementaires utiles pour un devis",
  "confidence": "high" ou "medium" ou "low"
}

REGLES :
- Si tu vois des dimensions ecrites (ex: "3m x 2.5m"), mets-les dans dimensions.
- Si tu vois des articles, quantites ou prix, mets-les dans materials.
- Si tu vois du texte (plan manuscrit, facture), transcris-le dans extractedText.
- Pour materials, si un produit correspond au catalogue, mets sa ref et son unitPrice.
- Ne mets AUCUN texte en dehors du JSON.
- Si tu ne peux pas analyser, mets confidence: "low" et explique dans notes.`;
}

// ------------------------------------------------------------------
// Conversion fichier local en base64 (data URI)
// ------------------------------------------------------------------
function fileToBase64(filePath, mimeType) {
    const buffer = fs.readFileSync(filePath);
    return 'data:' + mimeType + ';base64,' + buffer.toString('base64');
}

// ------------------------------------------------------------------
// GROQ (gratuit, prioritaire)
// ------------------------------------------------------------------
async function analyzeWithGroq(imagePath, mimeType, prompt) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY non configure');
    }

    const client = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY
    });

    const dataUri = fileToBase64(imagePath, mimeType);

    // Modeles vision disponibles chez Groq
    const models = [
        'llama-3.2-90b-vision-preview',
        'llama-3.2-11b-vision-preview'
    ];

    let lastError = null;
    for (const model of models) {
        try {
            const completion = await client.chat.completions.create({
                model: model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: dataUri } }
                    ]
                }],
                temperature: 0.1,
                max_tokens: 1500
            });

            return {
                provider: 'groq',
                model: model,
                content: completion.choices[0].message.content
            };
        } catch (err) {
            console.warn('Groq vision (' + model + ') echec:', err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('Groq vision indisponible');
}

// ------------------------------------------------------------------
// GOOGLE GEMINI
// ------------------------------------------------------------------
async function analyzeWithGemini(imagePath, mimeType, prompt) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY non configure');
    }

    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');

    const model = 'gemini-1.5-flash';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1500
        }
    };

    const res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000
    });

    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
        throw new Error('Reponse Gemini vide');
    }

    return {
        provider: 'gemini',
        model: model,
        content: content
    };
}

// ------------------------------------------------------------------
// OPENAI
// ------------------------------------------------------------------
async function analyzeWithOpenAI(imagePath, mimeType, prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-votre-cle-ici') {
        throw new Error('OPENAI_API_KEY non configure');
    }

    const client = new OpenAI({ apiKey: apiKey });
    const dataUri = fileToBase64(imagePath, mimeType);

    const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUri } }
            ]
        }],
        temperature: 0.1,
        max_tokens: 1500
    });

    return {
        provider: 'openai',
        model: 'gpt-4o',
        content: completion.choices[0].message.content
    };
}

// ------------------------------------------------------------------
// Extraction du JSON d'une reponse IA (robuste)
// ------------------------------------------------------------------
function extractJson(content) {
    if (!content) throw new Error('Reponse vide');

    // Enlever les balises de code markdown
    let cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Trouver les premieres et dernieres accolades
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end === -1) {
        throw new Error('Pas de JSON dans la reponse');
    }

    const jsonStr = cleaned.substring(start, end + 1);
    return JSON.parse(jsonStr);
}

// ------------------------------------------------------------------
// Point d'entree : analyse avec fallback en cascade
// ------------------------------------------------------------------
async function analyzeImage(imagePath, mimeType, userPrompt, productsCatalog) {
    const prompt = buildPrompt(userPrompt, productsCatalog);
    const startTime = Date.now();

    const providers = [
        { name: 'groq', fn: analyzeWithGroq },
        { name: 'gemini', fn: analyzeWithGemini },
        { name: 'openai', fn: analyzeWithOpenAI }
    ];

    const errors = [];

    for (const provider of providers) {
        try {
            console.log('Tentative analyse via ' + provider.name + '...');

            const result = await provider.fn(imagePath, mimeType, prompt);
            const parsed = extractJson(result.content);

            return {
                success: true,
                provider: result.provider,
                model: result.model,
                data: parsed,
                rawResponse: result.content,
                durationMs: Date.now() - startTime
            };
        } catch (err) {
            console.warn(provider.name + ' echec: ' + err.message);
            errors.push(provider.name + ' : ' + err.message);
        }
    }

    return {
        success: false,
        error: 'Tous les fournisseurs ont echoue :\n' + errors.join('\n'),
        durationMs: Date.now() - startTime
    };
}

module.exports = { analyzeImage };