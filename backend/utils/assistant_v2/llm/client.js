// backend/utils/assistant/llm/client.js
// Client LLM centralisé : Groq (chat) + Ollama (embeddings)
// Toute la logique de retry, fallback et timeout est ici.

const OpenAI = require('openai');

// ────────────────────────────────────────────────────────────
// CLIENTS
// ────────────────────────────────────────────────────────────
let groqClient = null;
if (process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
        timeout: 30000,
        maxRetries: 2,
    });
} else {
    console.warn('⚠️  [LLM] GROQ_API_KEY manquante — le chat ne fonctionnera pas.');
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.2';

// ────────────────────────────────────────────────────────────
// CONFIG DES MODÈLES GROQ (fallback en cascade)
// ────────────────────────────────────────────────────────────
const GROQ_MODELS = {
    // Gros modèle : Planner, Critic, Conversational
    heavy: [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
    ],
    // Petit modèle : Extractor, Intent
    light: [
        'openai/gpt-oss-20b',
    ],
};

// ────────────────────────────────────────────────────────────
// CHAT — appel principal vers Groq avec fallback
// ────────────────────────────────────────────────────────────
/**
 * Appelle Groq en chat completion.
 * @param {Object} opts
 * @param {string} opts.system     - Prompt système
 * @param {string} opts.user       - Message utilisateur
 * @param {'heavy'|'light'} opts.tier - Niveau de modèle
 * @param {boolean} opts.json      - Force une sortie JSON
 * @param {number} opts.temperature
 * @param {number} opts.maxTokens
 * @returns {Promise<string>} Contenu texte brut
 */
async function chat({
    system,
    user,
    tier = 'heavy',
    json = false,
    temperature = 0.2,
    maxTokens = 1500,
}) {
    if (!groqClient) {
        throw new Error('Groq non configuré (GROQ_API_KEY manquante)');
    }

    const models = GROQ_MODELS[tier] || GROQ_MODELS.heavy;
    let lastError = null;

    for (const model of models) {
        const startedAt = Date.now();
        try {
            const completion = await groqClient.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                temperature,
                max_tokens: maxTokens,
                ...(json ? { response_format: { type: 'json_object' } } : {}),
            });

            const content = completion.choices[0]?.message?.content;
            if (!content) throw new Error('Réponse vide');

            const durationMs = Date.now() - startedAt;
            console.log(`🤖 [LLM] ${tier}/${model} → ${durationMs}ms`);
            return content;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️  [LLM] ${model} échec : ${err.message.slice(0, 120)}`);
        }
    }

    throw new Error(`Tous les modèles Groq ont échoué : ${lastError?.message}`);
}

/**
 * Chat avec parsing JSON automatique + nettoyage des fences markdown.
 */
async function chatJSON(opts) {
    const raw = await chat({ ...opts, json: true });
    return parseJSONSafe(raw);
}

/**
 * Parse un JSON en nettoyant les fences ```json ... ```
 */
function parseJSONSafe(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Réponse LLM vide ou non-string');
    }
    let content = raw.trim();
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const start = content.indexOf('{');
    const startArr = content.indexOf('[');
    let realStart = start;
    if (start === -1) realStart = startArr;
    else if (startArr !== -1 && startArr < start) realStart = startArr;

    const end = content.lastIndexOf('}');
    const endArr = content.lastIndexOf(']');
    let realEnd = end;
    if (end === -1) realEnd = endArr;
    else if (endArr !== -1 && endArr > end) realEnd = endArr;

    if (realStart === -1 || realEnd === -1) {
        throw new Error('Aucun JSON détecté dans la réponse LLM');
    }

    const jsonStr = content.substring(realStart, realEnd + 1);
    try {
        return JSON.parse(jsonStr);
    } catch (err) {
        throw new Error(`JSON invalide : ${err.message} — brut : ${jsonStr.slice(0, 200)}`);
    }
}

// ────────────────────────────────────────────────────────────
// EMBEDDINGS — Ollama (local)
// ────────────────────────────────────────────────────────────
/**
 * Génère un embedding via Ollama.
 * @param {string} text
 * @returns {Promise<number[]>} Vecteur de 768 dimensions
 */
async function embed(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('embed() : texte requis');
    }

    // Tronquer pour éviter les abus (Ollama n'aime pas les très longs textes)
    const safeText = text.slice(0, 8000);

    try {
        const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_EMBED_MODEL,
                prompt: safeText,
            }),
            signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama HTTP ${response.status} : ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        if (!data.embedding || !Array.isArray(data.embedding)) {
            throw new Error('Ollama : réponse sans embedding');
        }

        if (data.embedding.length !== 768) {
            console.warn(`⚠️  [Ollama] embedding de ${data.embedding.length} dims (attendu 768). Vérifie OLLAMA_EMBED_MODEL.`);
        }

        return data.embedding;
    } catch (err) {
        console.error(`❌ [Ollama] embed échec : ${err.message}`);
        throw err;
    }
}

/**
 * Génère des embeddings en batch (séquentiel, Ollama ne supporte pas le batch natif).
 */
async function embedBatch(texts) {
    const results = [];
    for (const text of texts) {
        try {
            const vec = await embed(text);
            results.push(vec);
        } catch (err) {
            console.warn(`⚠️  [Ollama] batch item ignoré : ${err.message}`);
            results.push(null);
        }
    }
    return results;
}

// ────────────────────────────────────────────────────────────
// HEALTH CHECK
// ────────────────────────────────────────────────────────────
async function healthCheck() {
    const status = {
        groq: !!groqClient,
        ollama: false,
        ollamaEmbedModel: OLLAMA_EMBED_MODEL,
        groqModels: GROQ_MODELS,
    };

    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const data = await res.json();
            const models = (data.models || []).map(m => m.name);
            status.ollama = models.some(m => m.includes(OLLAMA_EMBED_MODEL));
            status.ollamaModels = models;
        }
    } catch (err) {
        status.ollamaError = err.message;
    }

    return status;
}

module.exports = {
    chat,
    chatJSON,
    embed,
    embedBatch,
    parseJSONSafe,
    healthCheck,
    GROQ_MODELS,
    OLLAMA_URL,
    OLLAMA_EMBED_MODEL,
};