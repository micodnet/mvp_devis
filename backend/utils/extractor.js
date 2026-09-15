/*
 * ============================================================
 * extractor.js - AI extraction engine for quotes
 * ============================================================
 * This file calls multiple AI providers (Groq, KeylessAI, OpenRouter)
 * to extract items from a text. If all fail, it uses the local
 * catalog (price-db.json) as fallback.
 *
 * CHANGELOG (last update):
 *  - [FIX] Quantity regex: now limited to 1-3 digits + escapeRegex (was matching refs like "1001")
 *  - [FIX] Local fallback: no more fake default product (returns empty array instead)
 *  - [FIX] Groq models order: "openai/gpt-oss-20b" first (the other one no longer exists)
 *  - [STYLE] All variables/functions renamed to English for consistency
 */

// Import product catalog from JSON file
const { products } = require('../data/price-db.json');

console.log(`Catalog loaded: ${products.length} products available.`);

// ============================================================
// 1. AI PROVIDERS INITIALIZATION
// ============================================================

let groqClient = null;
let openRouterClient = null;

try {
    const OpenAI = require('openai');

    // Groq (primary)
    if (process.env.GROQ_API_KEY) {
        groqClient = new OpenAI({
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: process.env.GROQ_API_KEY,
        });
        console.log('Groq connected (primary).');
    } else {
        console.log('GROQ_API_KEY missing.');
    }

    // OpenRouter (optional fallback)
    if (process.env.OPENROUTER_API_KEY) {
        openRouterClient = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: process.env.OPENROUTER_API_KEY,
        });
        console.log('OpenRouter connected (fallback).');
    }
} catch (e) {
    console.log('OpenAI SDK not loaded.');
}

// Escape special regex characters
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 2. EXTRACT JSON FROM A RAW RESPONSE
// ============================================================

function extractJSON(rawData) {
    // Remove code markers (```json ... ```)
    let cleaned = rawData.replace(/```json/g, '').replace(/```/g, '').trim();
    // Find first '[' and last ']'
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
        throw new Error('No valid JSON found.');
    }
    const jsonStr = cleaned.substring(start, end + 1);
    return JSON.parse(jsonStr);
}

// ============================================================
// 3. AI PROVIDER CALLS
// ============================================================

// 3.1 - GROQ (with fallback across multiple valid models)
async function callGroq(prompt) {
    if (!groqClient) throw new Error('Groq not initialized');

    // Free models available on Groq (verified)
    const models = [
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
        'mixtral-8x7b-32768',
    ];

    let lastError = null;
    for (const model of models) {
        try {
            const response = await groqClient.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 1200,
            });
            const content = response.choices[0].message.content;
            console.log(`Groq responded with model: ${model}`);
            return extractJSON(content);
        } catch (err) {
            console.warn(`Groq (${model}) failed: ${err.message}`);
            lastError = err;
        }
    }
    throw lastError || new Error('All Groq models failed');
}

// 3.2 - KeylessAI (free, no key, but can be unstable)
async function callKeylessAI(prompt) {
    // 15-second timeout to avoid blocking
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
        const content = data.choices[0].message.content;
        return extractJSON(content);
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// 3.3 - OpenRouter (fallback if you have a key)
async function callOpenRouter(prompt) {
    if (!openRouterClient) throw new Error('OpenRouter not initialized');
    const response = await openRouterClient.chat.completions.create({
        model: 'google/gemini-2.0-flash-lite-preview-02-05:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1200,
    });
    const content = response.choices[0].message.content;
    return extractJSON(content);
}

// ============================================================
// 4. LOCAL FALLBACK (uses your JSON catalog)
// ============================================================

function localFallback(text, logs) {
    logs.push('[Fallback] Searching local catalog (price-db.json).');
    const results = [];
    const lowerText = text.toLowerCase();

    // Loop through every product in the catalog
    products.forEach(product => {
        const name = product.name.toLowerCase();
        const ref = product.ref.toLowerCase();

        // Check if name OR ref appears in the text
        if (lowerText.includes(name) || lowerText.includes(ref)) {
            // Default quantity = 1
            let qty = 1;

            // FIX: strict regex for quantity (1-3 digits, word boundary, escapes special chars)
            const safeName = escapeRegex(product.name);
            const regex = new RegExp(
                `(\\b\\d{1,3})\\s+(?:x\\s+|unités?\\s+|pièces?\\s+|articles?\\s+)?${safeName}`,
                'i'
            );
            const match = text.match(regex);
            if (match) {
                const parsed = parseInt(match[1]);
                if (parsed >= 1 && parsed <= 999) qty = parsed;
            }

            results.push({
                ref: product.ref,
                name: product.name,
                qty: qty,
                unitPrice: product.unitPrice,
                total: qty * product.unitPrice,
            });
            logs.push(`[Fallback] "${product.name}" found -> ${qty} unit(s).`);
        }
    });

    // FIX: no more fake default product — return empty array instead
    if (results.length === 0) {
        logs.push('[Fallback] No product from the catalog found in the document.');
        return [];
    }

    return results;
}

// ============================================================
// 5. PRODUCT MATCHING FUNCTION
// ============================================================

function matchProducts(extractedItems, logs, providerName) {
    if (!Array.isArray(extractedItems) || extractedItems.length === 0) {
        logs.push(`${providerName} returned no items.`);
        return null;
    }

    logs.push(`${providerName} extracted ${extractedItems.length} items.`);
    const results = extractedItems.map(item => {
        // Search in local catalog
        const product = products.find(p =>
            p.ref === item.ref ||
            p.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(p.name.toLowerCase())
        );

        if (product) {
            logs.push(`[Match] "${item.name}" -> ${product.ref} (${product.unitPrice}€/u)`);
            return {
                ref: product.ref,
                name: product.name,
                qty: Math.max(1, parseInt(item.qty) || 1),
                unitPrice: product.unitPrice,
                total: Math.max(1, parseInt(item.qty) || 1) * product.unitPrice,
            };
        } else {
            // If not in catalog, use price suggested by AI
            let unitPrice = item.unitPrice || item.price || 0;
            if (unitPrice === 0 || isNaN(unitPrice)) {
                unitPrice = 15.00; // Default price
                logs.push(`[Default] "${item.name}" not found, price 15.00€/u`);
            } else {
                logs.push(`[Document] "${item.name}" price read: ${unitPrice}€/u`);
            }
            return {
                ref: item.ref || 'EXT-' + String(Math.random()).slice(2, 6),
                name: item.name || 'Unnamed item',
                qty: Math.max(1, parseInt(item.qty) || 1),
                unitPrice: parseFloat(unitPrice),
                total: Math.max(1, parseInt(item.qty) || 1) * parseFloat(unitPrice),
            };
        }
    });
    return results;
}

// ============================================================
// 6. MAIN ORCHESTRATOR (called by server.js)
// ============================================================

async function extractItemsFromText(text) {
    const logs = [];

    // Prompt sent to the AI
    const prompt = `
    You are an expert assistant at extracting quote data.
    Here is the text of a customer request:
    """${text.slice(0, 3000)}"""
    
    Extract the requested items in strict JSON format.
    Format: [{"ref":"string","name":"string","qty":number,"unitPrice":number}]
    
    Rules:
    - If a unit price is mentioned in the text, use it.
    - If no price is mentioned, set "unitPrice": 0.
    - If no reference is given, invent a ref starting with "EXT".
    - Reply only with JSON, no additional text.`;

    // List of providers (order: Groq -> KeylessAI -> OpenRouter)
    const providers = [
        { name: 'Groq', fn: callGroq, available: !!groqClient },
        { name: 'KeylessAI', fn: callKeylessAI, available: true },
        { name: 'OpenRouter', fn: callOpenRouter, available: !!openRouterClient },
    ];

    let finalItems = null;

    // Try each provider
    for (const provider of providers) {
        if (!provider.available) continue;
        try {
            logs.push(`[${provider.name}] Attempt...`);
            const extracted = await provider.fn(prompt);
            const matched = matchProducts(extracted, logs, provider.name);
            if (matched && matched.length > 0) {
                finalItems = matched;
                logs.push(`[${provider.name}] Success!`);
                break;
            }
        } catch (err) {
            logs.push(`[${provider.name}] Failed: ${err.message}`);
        }
    }

    // If no provider worked, use local fallback (your JSON catalog)
    if (!finalItems) {
        logs.push('All providers failed, switching to local fallback.');
        finalItems = localFallback(text, logs);
    }

    // Compute total
    const total = finalItems.reduce((sum, item) => sum + item.total, 0);
    logs.push(`Total: ${total.toFixed(2)} €`);

    return { items: finalItems, logs };
}

module.exports = { extractItemsFromText };