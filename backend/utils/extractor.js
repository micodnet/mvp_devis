/*
 * extractor.js - AI extraction engine for quotes
 */
// Le catalogue n'est plus lu en dur : il est passé en paramètre depuis server.js
// const { products } = require('../data/price-db.json');
// console.log(`Catalog loaded: ${products.length} products available.`);

// ============================================================
// 1. AI PROVIDERS INITIALIZATION
// ============================================================

let groqClient = null;
let openRouterClient = null;

try {
    const OpenAI = require('openai');

    if (process.env.GROQ_API_KEY) {
        groqClient = new OpenAI({
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: process.env.GROQ_API_KEY,
        });
        console.log('Groq connected (primary).');
    } else {
        console.log('GROQ_API_KEY missing.');
    }

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

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 2. ROBUST JSON EXTRACTION
// ============================================================
// Handles:
//   - Plain array: [ {...} ]
//   - Wrapped object: { "items": [ {...} ] }
//   - Code fences: ```json ... ```
//   - Trailing text after JSON

function extractJSON(rawData) {
    // Remove code fences
    let cleaned = String(rawData)
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    // Try direct parse first
    try {
        const direct = JSON.parse(cleaned);
        if (Array.isArray(direct)) return direct;
        if (direct && Array.isArray(direct.items)) return direct.items;
        if (direct && Array.isArray(direct.articles)) return direct.articles;
        if (direct && Array.isArray(direct.products)) return direct.products;
    } catch (e) { /* continue */ }

    // Try to locate a JSON array
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
        const candidate = cleaned.substring(arrStart, arrEnd + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* continue */ }
    }

    // Try to locate a JSON object
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
        const candidate = cleaned.substring(objStart, objEnd + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && Array.isArray(parsed.items)) return parsed.items;
            if (parsed && Array.isArray(parsed.articles)) return parsed.articles;
            if (parsed && Array.isArray(parsed.products)) return parsed.products;
            if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* continue */ }
    }

    console.warn('extractJSON: could not parse. Raw response:', cleaned.slice(0, 300));
    throw new Error('No valid JSON found.');
}

// ============================================================
// 3. AI PROVIDER CALLS
// ============================================================

async function callGroq(prompt) {
    if (!groqClient) throw new Error('Groq not initialized');

    // Only models that are currently valid on Groq
    const models = [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
    ];

    let lastError = null;
    for (const model of models) {
        try {
            const response = await groqClient.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a JSON-only extraction assistant. You always reply with a valid JSON array, nothing else. No explanations, no markdown, no code fences.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 1200,
                response_format: { type: 'json_object' },
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

async function callKeylessAI(prompt) {
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
                temperature: 0.1,
                max_tokens: 1200,
            }),
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`KeylessAI error: ${response.status}`);
        const data = await response.json();
        return extractJSON(data.choices[0].message.content);
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

async function callOpenRouter(prompt) {
    if (!openRouterClient) throw new Error('OpenRouter not initialized');
    const response = await openRouterClient.chat.completions.create({
        model: 'google/gemini-2.0-flash-lite-preview-02-05:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1200,
    });
    return extractJSON(response.choices[0].message.content);
}

// ============================================================
// 4. LOCAL FALLBACK
// ============================================================

function localFallback(text, logs, products) {
    logs.push('[Fallback] Searching local catalog (price-db.json).');
    const results = [];
    const lowerText = text.toLowerCase();

    products.forEach(product => {
        const name = product.name.toLowerCase();
        const ref = product.ref.toLowerCase();

        if (lowerText.includes(name) || lowerText.includes(ref)) {
            let qty = 1;
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

    if (results.length === 0) {
        logs.push('[Fallback] No product from the catalog found in the document.');
        return [];
    }
    return results;
}

// ============================================================
// 5. PRODUCT MATCHING
// ============================================================

function matchProducts(extractedItems, logs, providerName, products) {
    if (!Array.isArray(extractedItems) || extractedItems.length === 0) {
        logs.push(`${providerName} returned no items.`);
        return null;
    }

    logs.push(`${providerName} extracted ${extractedItems.length} items.`);
    return extractedItems.map(item => {
        // Safely resolve name/ref
        const itemName = String(item.name || item.designation || item.label || '').trim();
        const itemRef = String(item.ref || item.reference || item.sku || '').trim();

        const product = products.find(p =>
            (itemRef && p.ref === itemRef) ||
            (itemName && p.name.toLowerCase().includes(itemName.toLowerCase())) ||
            (itemName && itemName.toLowerCase().includes(p.name.toLowerCase()))
        );

        if (product) {
            logs.push(`[Match] "${itemName}" -> ${product.ref} (${product.unitPrice}€/u)`);
            const q = Math.max(1, parseInt(item.qty) || 1);
            return {
                ref: product.ref,
                name: product.name,
                qty: q,
                unitPrice: product.unitPrice,
                total: q * product.unitPrice,
            };
        } else {
            let unitPrice = parseFloat(item.unitPrice || item.price || 0);
            if (!unitPrice || isNaN(unitPrice) || unitPrice <= 0) {
                unitPrice = 15.00;
                logs.push(`[Default] "${itemName || 'Unnamed'}" not found, price 15.00€/u`);
            } else {
                logs.push(`[Document] "${itemName}" price read: ${unitPrice}€/u`);
            }
            const q = Math.max(1, parseInt(item.qty) || 1);
            return {
                ref: itemRef || 'EXT-' + String(Math.random()).slice(2, 6),
                name: itemName || 'Unnamed item',
                qty: q,
                unitPrice,
                total: q * unitPrice,
            };
        }
    });
}

// ============================================================
// 6. MAIN ORCHESTRATOR
// ============================================================

async function extractItemsFromText(text, products = []) {
    const logs = [];

    const prompt = `Extract all requested items from the following customer request text.

TEXT:
"""
${text.slice(0, 3000)}
"""

Return a JSON OBJECT with a single key "items" that contains an ARRAY of item objects.
Each item must have exactly these keys:
- "ref": string (use the product reference if visible, otherwise generate one starting with "EXT")
- "name": string (the product name or description)
- "qty": number (quantity, minimum 1)
- "unitPrice": number (unit price if mentioned, otherwise 0)

Example output:
{"items":[{"ref":"REF-1001","name":"Ampoule LED 10W","qty":5,"unitPrice":12.5}]}

RULES:
- Reply with JSON ONLY. No text before or after.
- No markdown, no code fences.
- If no items can be extracted, reply: {"items":[]}`;

    const providers = [
        { name: 'Groq', fn: callGroq, available: !!groqClient },
        { name: 'KeylessAI', fn: callKeylessAI, available: true },
        { name: 'OpenRouter', fn: callOpenRouter, available: !!openRouterClient },
    ];

    let finalItems = null;

    for (const provider of providers) {
        if (!provider.available) continue;
        try {
            logs.push(`[${provider.name}] Attempt...`);
            const extracted = await provider.fn(prompt);
            const matched = matchProducts(extracted, logs, provider.name, products);
            if (matched && matched.length > 0) {
                finalItems = matched;
                logs.push(`[${provider.name}] Success!`);
                break;
            } else {
                logs.push(`[${provider.name}] No items matched, trying next provider.`);
            }
        } catch (err) {
            logs.push(`[${provider.name}] Failed: ${err.message}`);
        }
    }

    if (!finalItems) {
        logs.push('All providers failed, switching to local fallback.');
        finalItems = localFallback(text, logs, products);
    }

    const total = finalItems.reduce((sum, item) => sum + item.total, 0);
    logs.push(`Total: ${total.toFixed(2)} €`);

    return { items: finalItems, logs };
}

module.exports = { extractItemsFromText };