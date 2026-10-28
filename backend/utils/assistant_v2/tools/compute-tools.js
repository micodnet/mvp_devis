// backend/utils/assistant/tools/compute-tools.js
// Outils de CALCUL — déterministe, aucun appel LLM.

const { pool } = require('../../../db');
const { calculerDevisDepuisTexte, calculerDevisMultiMetiers, detecterMetier } = require('../../assistant/metiers');
const { getHourlyRateForMetier, applyMargin } = require('../../assistant/preferences');

// ────────────────────────────────────────────────────────────
// Charge produits + services de l'utilisateur (pour les calculs)
// ────────────────────────────────────────────────────────────
async function loadUserCatalog(userId) {
    const [productsResult, servicesResult] = await Promise.all([
        pool.query('SELECT ref, name, unit_price FROM products WHERE user_id = $1', [userId]),
        pool.query(
            'SELECT ref, name, unit_price, unit, is_labor FROM services WHERE user_id = $1 AND active = TRUE',
            [userId]
        ),
    ]);
    return {
        products: productsResult.rows.map(p => ({
            ref: p.ref,
            name: p.name,
            unitPrice: parseFloat(p.unit_price),
        })),
        services: servicesResult.rows.map(s => ({
            ref: s.ref,
            name: s.name,
            unitPrice: parseFloat(s.unit_price),
            unit: s.unit,
            isLabor: s.is_labor,
        })),
    };
}

// ────────────────────────────────────────────────────────────
// APPLIQUE les préférences utilisateur (taux, marge)
// ────────────────────────────────────────────────────────────
function applyUserPreferences(items, metierName, userPrefs) {
    if (!userPrefs) return items;
    return items.map(item => {
        if (item.ref && item.ref.startsWith('MO-')) {
            const taux = getHourlyRateForMetier(userPrefs, metierName);
            item.unitPrice = taux;
            item.total = Math.round(item.qty * taux * 100) / 100;
        } else if (userPrefs.defaultMarginPercent > 0) {
            item.unitPrice = applyMargin(item.unitPrice, userPrefs.defaultMarginPercent);
            item.total = Math.round(item.qty * item.unitPrice * 100) / 100;
        }
        return item;
    });
}

// ────────────────────────────────────────────────────────────
// CALCUL MONO-MÉTIER
// ────────────────────────────────────────────────────────────
async function calculateSingleMetier(userId, args, context = {}) {
    const { description } = args;
    if (!description) return { error: 'Description manquante' };

    const { products, services } = await loadUserCatalog(userId);
    const userPrefs = context.userPrefs;

    let desc = description;
    if (userPrefs?.voiceCorrections) {
        const { applyVoiceCorrections } = require('../../assistant/preferences');
        desc = applyVoiceCorrections(desc, userPrefs.voiceCorrections);
    }

    const result = await calculerDevisDepuisTexte(desc, products, services);
    if (!result.success) return { error: result.error };

    result.items = applyUserPreferences(result.items, result.metier, userPrefs);
    const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);

    return {
        type: 'single',
        metier: result.metier,
        items: result.items,
        heures: result.heures,
        surface: result.surface,
        subtotal: Math.round(subtotal * 100) / 100,
        logs: result.logs,
    };
}

// ────────────────────────────────────────────────────────────
// CALCUL MULTI-MÉTIERS (chantier)
// ────────────────────────────────────────────────────────────
async function calculateMultiMetiers(userId, args, context = {}) {
    const { description } = args;
    if (!description) return { error: 'Description manquante' };

    const { products, services } = await loadUserCatalog(userId);
    const userPrefs = context.userPrefs;

    let desc = description;
    if (userPrefs?.voiceCorrections) {
        const { applyVoiceCorrections } = require('../../assistant/preferences');
        desc = applyVoiceCorrections(desc, userPrefs.voiceCorrections);
    }

    const result = await calculerDevisMultiMetiers(desc, products, services);
    if (!result.success) return { error: result.error };

    const metierName = result.metiers?.[0] || null;
    result.items = applyUserPreferences(result.items, metierName, userPrefs);
    const subtotal = result.items.reduce((sum, i) => sum + i.total, 0);

    return {
        type: 'multi',
        metiers: result.metiers,
        items: result.items,
        heures: result.heures,
        subtotal: Math.round(subtotal * 100) / 100,
        logs: result.logs,
    };
}

// ────────────────────────────────────────────────────────────
// AUTO-DÉTECTION : mono ou multi ?
// ────────────────────────────────────────────────────────────
async function calculateAuto(userId, args, context = {}) {
    const { description } = args;
    if (!description) return { error: 'Description manquante' };

    // Détecter si plusieurs métiers sont mentionnés
    const { METIERS } = require('../../assistant/metiers');
    const lower = String(description).toLowerCase();
    const detected = new Set();
    for (const m of METIERS) {
        for (const kw of m.keywords) {
            if (lower.includes(kw.toLowerCase())) {
                detected.add(m.name);
                break;
            }
        }
    }

    if (detected.size >= 2) {
        return await calculateMultiMetiers(userId, args, context);
    }
    return await calculateSingleMetier(userId, args, context);
}

// ────────────────────────────────────────────────────────────
// DÉTECTION DU MÉTIER (pour usage direct)
// ────────────────────────────────────────────────────────────
async function detectMetier(userId, args) {
    const metier = detecterMetier(String(args.description || ''));
    return {
        metier: metier?.name || null,
        keywords: metier?.keywords || [],
    };
}

module.exports = {
    calculateSingleMetier,
    calculateMultiMetiers,
    calculateAuto,
    detectMetier,
    loadUserCatalog,
    applyUserPreferences,
};