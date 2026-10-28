// // backend/utils/assistant/calculators.js
// // Moteur de calcul métier pour générer des devis automatiques
// // Version "config-driven" : les formules sont dans data/calculators.json

// const fs = require('fs');
// const path = require('path');

// let CALCULATORS = {};
// try {
//     const filePath = path.join(__dirname, '..', '..', 'data', 'calculators.json');
//     CALCULATORS = JSON.parse(fs.readFileSync(filePath, 'utf8'));
//     console.log(`🧮 ${Object.keys(CALCULATORS).length} calculateurs métier chargés.`);
// } catch (err) {
//     console.error('Erreur chargement calculators.json:', err.message);
// }

// // ------------------------------------------------------------
// // Évalue une formule simple en toute sécurité
// // Args : { surface, longueur, largeur, hauteur, perimetre, quantite, ceil, Math }
// // ------------------------------------------------------------
// function evaluateFormula(formula, vars) {
//     // Sécuriser : autoriser uniquement chiffres, opérateurs, parenthèses, ceil, Math, noms de vars
//     const safe = formula.replace(/ceil/g, 'Math.ceil').replace(/\bfloor\b/g, 'Math.floor');
//     // Créer un contexte avec les variables
//     const context = {
//         ...vars,
//         Math,
//     };
//     // Utiliser Function avec contexte restreint
//     try {
//         const fn = new Function(...Object.keys(context), `return (${safe});`);
//         const result = fn(...Object.values(context));
//         if (typeof result !== 'number' || !isFinite(result)) throw new Error('Résultat non numérique');
//         return result;
//     } catch (err) {
//         console.warn('Formule invalide:', formula, err.message);
//         return 0;
//     }
// }

// // ------------------------------------------------------------
// // Arrondit une quantité selon la règle (roundUpTo)
// // ------------------------------------------------------------
// function roundQuantity(qty, roundTo) {
//     if (!roundTo || roundTo <= 0) return qty;
//     return Math.ceil(qty / roundTo) * roundTo;
// }

// // ------------------------------------------------------------
// // Détecte le métier depuis un texte
// // ------------------------------------------------------------
// function detectJob(text) {
//     if (!text) return null;
//     const lower = text.toLowerCase();

//     let bestMatch = null;
//     let bestScore = 0;

//     for (const [key, calc] of Object.entries(CALCULATORS)) {
//         let score = 0;
//         for (const kw of calc.detectKeywords) {
//             if (lower.includes(kw.toLowerCase())) {
//                 score += kw.length; // mot plus long = plus spécifique
//             }
//         }
//         if (score > bestScore) {
//             bestScore = score;
//             bestMatch = key;
//         }
//     }
//     return bestMatch;
// }

// // ------------------------------------------------------------
// // Extrait les dimensions d'un texte (m, cm, mm)
// // Retourne { longueur, largeur, hauteur, surface, perimetre, quantite }
// // ------------------------------------------------------------
// function extractDimensions(text) {
//     const lower = text.toLowerCase().replace(/,/g, '.');
//     const dims = { longueur: 0, largeur: 0, hauteur: 0, surface: 0, perimetre: 0, quantite: 0 };

//     // Regex pour capturer "3m", "3.5m", "350cm", "3500mm"
//     const unitRegex = /(\d+(?:\.\d+)?)\s*(m2|m²|m|cm|mm)\b/gi;
//     const found = [];
//     let m;
//     while ((m = unitRegex.exec(lower)) !== null) {
//         let value = parseFloat(m[1]);
//         const unit = m[2].toLowerCase();
//         if (unit === 'cm') value = value / 100;
//         if (unit === 'mm') value = value / 1000;
//         found.push({ value, unit, raw: m[0] });
//     }

//     // Détecter les patterns courants
//     // "5 murs de 3m sur 2.5m" → longueur=3, hauteur=2.5, quantite=5
//     const multiMatch = lower.match(/(\d+)\s*(murs?|plaques?|portes?|fenêtres?|pièces?|prises?|points?\s*d'eau)/);
//     if (multiMatch) dims.quantite = parseInt(multiMatch[1]);

//     // "3m x 2.5m" ou "3 x 2.5m" ou "3m sur 2.5m"
//     const surfaceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|m²)?\s*(?:x|×|sur|\*)\s*(\d+(?:\.\d+)?)\s*(?:m|m²)?/);
//     if (surfaceMatch) {
//         dims.longueur = parseFloat(surfaceMatch[1]);
//         dims.largeur = parseFloat(surfaceMatch[2]);
//     } else if (found.length >= 2) {
//         // Prendre les 2 premières valeurs trouvées
//         dims.longueur = found[0].value;
//         dims.largeur = found[1].value;
//     } else if (found.length === 1) {
//         // Une seule valeur → c'est probablement une surface directe
//         if (found[0].unit === 'm2' || found[0].unit === 'm²') {
//             dims.surface = found[0].value;
//         } else {
//             dims.longueur = found[0].value;
//         }
//     }

//     // "surface de 30 m²"
//     const directSurfaceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m²|m2)/);
//     if (directSurfaceMatch) {
//         dims.surface = parseFloat(directSurfaceMatch[1]);
//     }

//     // Calculer la surface finale
//     if (!dims.surface && dims.longueur && dims.largeur) {
//         dims.surface = dims.longueur * dims.largeur * (dims.quantite || 1);
//     } else if (dims.surface && dims.quantite) {
//         dims.surface = dims.surface * dims.quantite;
//     }

//     // Périmètre (approximatif : 2*(L+l))
//     if (dims.longueur && dims.largeur) {
//         dims.perimetre = 2 * (dims.longueur + dims.largeur) * (dims.quantite || 1);
//     }

//     // Quantité par défaut
//     if (!dims.quantite) dims.quantite = 1;

//     return dims;
// }

// // ------------------------------------------------------------
// // Calcule un devis complet pour un métier donné
// // ------------------------------------------------------------
// async function calculateQuote(jobKey, dimensions, userProducts = [], userServices = [], vatRegime = 'franchise', vatRate = 21) {
//     const calc = CALCULATORS[jobKey];
//     if (!calc) throw new Error(`Métier "${jobKey}" non reconnu.`);

//     const vars = {
//         surface: dimensions.surface || 0,
//         longueur: dimensions.longueur || 0,
//         largeur: dimensions.largeur || 0,
//         hauteur: dimensions.hauteur || 0,
//         perimetre: dimensions.perimetre || 0,
//         quantite: dimensions.quantite || 1,
//     };

//     if (vars.surface === 0 && vars.longueur === 0 && vars.quantite === 1) {
//         throw new Error('Impossible de calculer : aucune dimension valide trouvée dans votre demande.');
//     }

//     const items = [];
//     const logs = [];

//     // ---- Matériaux ----
//     for (const mat of calc.materials) {
//         const rawQty = evaluateFormula(mat.formula, vars);
//         const qty = roundQuantity(rawQty, mat.roundUpTo);

//         if (qty <= 0) continue;

//         // Chercher dans le catalogue utilisateur (par nom approximatif)
//         let unitPrice = mat.fallbackPrice || 0;
//         let ref = null;
//         const matched = userProducts.find(p =>
//             p.name.toLowerCase().includes(mat.name.toLowerCase().split(' ')[0]) ||
//             mat.name.toLowerCase().includes(p.name.toLowerCase().split(' ')[0])
//         );
//         if (matched) {
//             unitPrice = matched.unitPrice;
//             ref = matched.ref;
//             logs.push(`📦 "${mat.name}" → catalogue "${matched.name}" (${unitPrice}€)`);
//         } else {
//             logs.push(`📌 "${mat.name}" → prix par défaut (${unitPrice}€)`);
//         }

//         items.push({
//             ref: ref || 'CALC-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
//             name: mat.name,
//             qty: parseFloat(qty.toFixed(2)),
//             unitPrice: parseFloat(unitPrice),
//             total: parseFloat((qty * unitPrice).toFixed(2)),
//             unit: mat.unit,
//             category: 'Matériaux'
//         });
//     }

//     // ---- Main d'œuvre ----
//     if (calc.labor && vars.surface > 0) {
//         const rendement = calc.labor.rendementParHeure || 5;
//         const heures = vars.surface / rendement;
//         const tauxHoraire = calc.labor.tauxHoraireDefault || 45;

//         // Chercher un service "main d'œuvre" existant, sinon utiliser un taux par défaut
//         const mainOeuvreService = userServices.find(s =>
//             s.isLabor ||
//             s.name.toLowerCase().includes('main') ||
//             s.name.toLowerCase().includes('heure')
//         );

//         const refMOLabel = mainOeuvreService ? mainOeuvreService.name : `Main d'œuvre - ${calc.label}`;
//         const refMO = mainOeuvreService ? mainOeuvreService.ref : null;
//         const prixMO = mainOeuvreService ? mainOeuvreService.unitPrice : tauxHoraire;

//         items.push({
//             ref: refMO || 'MO-' + jobKey.toUpperCase().slice(0, 5),
//             name: refMOLabel,
//             qty: parseFloat(heures.toFixed(2)),
//             unitPrice: parseFloat(prixMO),
//             total: parseFloat((heures * prixMO).toFixed

// backend/utils/assistant/calculators.js
// Moteur de calcul métier pour générer des devis automatiques
// Version "config-driven" : les formules sont dans data/calculators.json

const fs = require('fs');
const path = require('path');

let CALCULATORS = {};
try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'calculators.json');
    CALCULATORS = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`🧮 ${Object.keys(CALCULATORS).length} calculateurs métier chargés.`);
} catch (err) {
    console.error('Erreur chargement calculators.json:', err.message);
}

// ------------------------------------------------------------
// Évalue une formule simple en toute sécurité
// ------------------------------------------------------------
function evaluateFormula(formula, vars) {
    if (typeof formula !== 'string' || formula.trim() === '') return 0;

    const safe = formula
        .replace(/\bceil\b/g, 'Math.ceil')
        .replace(/\bfloor\b/g, 'Math.floor')
        .replace(/\bround\b/g, 'Math.round')
        .replace(/\bmin\b/g, 'Math.min')
        .replace(/\bmax\b/g, 'Math.max');

    const context = { ...vars, Math };

    try {
        const fn = new Function(...Object.keys(context), `return (${safe});`);
        const result = fn(...Object.values(context));
        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Résultat non numérique');
        }
        return result;
    } catch (err) {
        console.warn(`⚠️ Formule invalide "${formula}":`, err.message);
        return 0;
    }
}

// ------------------------------------------------------------
// Arrondit une quantité selon la règle (roundUpTo)
// ------------------------------------------------------------
function roundQuantity(qty, roundTo) {
    if (!roundTo || roundTo <= 0) return qty;
    return Math.ceil(qty / roundTo) * roundTo;
}

// ------------------------------------------------------------
// Détecte le métier depuis un texte
// ------------------------------------------------------------
function detectJob(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    let bestMatch = null;
    let bestScore = 0;

    for (const [key, calc] of Object.entries(CALCULATORS)) {
        let score = 0;
        for (const kw of calc.detectKeywords || []) {
            if (lower.includes(kw.toLowerCase())) {
                score += kw.length; // mot plus long = plus spécifique
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = key;
        }
    }
    return bestMatch;
}

// ------------------------------------------------------------
// Extrait les dimensions d'un texte (m, cm, mm)
// ------------------------------------------------------------
function extractDimensions(text) {
    const lower = text.toLowerCase().replace(/,/g, '.');
    const dims = { longueur: 0, largeur: 0, hauteur: 0, surface: 0, perimetre: 0, quantite: 0 };

    const unitRegex = /(\d+(?:\.\d+)?)\s*(m2|m²|m|cm|mm)\b/gi;
    const found = [];
    let m;
    while ((m = unitRegex.exec(lower)) !== null) {
        let value = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        if (unit === 'cm') value = value / 100;
        if (unit === 'mm') value = value / 1000;
        found.push({ value, unit, raw: m[0] });
    }

    const multiMatch = lower.match(/(\d+)\s*(murs?|plaques?|portes?|fenêtres?|pièces?|prises?|points?\s*d'eau)/);
    if (multiMatch) dims.quantite = parseInt(multiMatch[1]);

    const surfaceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|m²)?\s*(?:x|×|sur|\*)\s*(\d+(?:\.\d+)?)\s*(?:m|m²)?/);
    if (surfaceMatch) {
        dims.longueur = parseFloat(surfaceMatch[1]);
        dims.largeur = parseFloat(surfaceMatch[2]);
    } else if (found.length >= 2) {
        dims.longueur = found[0].value;
        dims.largeur = found[1].value;
    } else if (found.length === 1) {
        if (found[0].unit === 'm2' || found[0].unit === 'm²') {
            dims.surface = found[0].value;
        } else {
            dims.longueur = found[0].value;
        }
    }

    const directSurfaceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m²|m2)/);
    if (directSurfaceMatch) {
        dims.surface = parseFloat(directSurfaceMatch[1]);
    }

    if (!dims.surface && dims.longueur && dims.largeur) {
        dims.surface = dims.longueur * dims.largeur * (dims.quantite || 1);
    } else if (dims.surface && dims.quantite) {
        dims.surface = dims.surface * dims.quantite;
    }

    if (dims.longueur && dims.largeur) {
        dims.perimetre = 2 * (dims.longueur + dims.largeur) * (dims.quantite || 1);
    }

    if (!dims.quantite) dims.quantite = 1;

    return dims;
}

// ------------------------------------------------------------
// Calcule un devis complet pour un métier donné
// ------------------------------------------------------------
async function calculateQuote(
    jobKey,
    dimensions,
    userProducts = [],
    userServices = [],
    vatRegime = 'franchise',
    vatRate = 21
) {
    const calc = CALCULATORS[jobKey];
    if (!calc) throw new Error(`Métier "${jobKey}" non reconnu.`);

    const vars = {
        surface: dimensions.surface || 0,
        longueur: dimensions.longueur || 0,
        largeur: dimensions.largeur || 0,
        hauteur: dimensions.hauteur || 0,
        perimetre: dimensions.perimetre || 0,
        quantite: dimensions.quantite || 1,
    };

    if (vars.surface === 0 && vars.longueur === 0 && vars.quantite === 1) {
        throw new Error('Impossible de calculer : aucune dimension valide trouvée dans votre demande.');
    }

    const items = [];
    const logs = [];

    // ---- Matériaux ----
    for (const mat of (calc.materials || [])) {
        const rawQty = evaluateFormula(mat.formula, vars);
        const qty = roundQuantity(rawQty, mat.roundUpTo);

        if (qty <= 0) continue;

        // Cherche dans le catalogue utilisateur
        let unitPrice = mat.fallbackPrice || 0;
        let ref = null;
        const firstWord = mat.name.toLowerCase().split(' ')[0];
        const matched = userProducts.find(p => {
            const pName = (p.name || '').toLowerCase();
            return pName.includes(firstWord) || mat.name.toLowerCase().includes(pName.split(' ')[0]);
        });

        if (matched) {
            unitPrice = matched.unitPrice;
            ref = matched.ref;
            logs.push(`📦 "${mat.name}" → catalogue "${matched.name}" (${unitPrice}€)`);
        } else {
            logs.push(`📌 "${mat.name}" → prix par défaut (${unitPrice}€)`);
        }

        items.push({
            ref: ref || 'CALC-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
            name: mat.name,
            qty: parseFloat(qty.toFixed(2)),
            unitPrice: parseFloat(unitPrice),
            total: parseFloat((qty * unitPrice).toFixed(2)),
            unit: mat.unit || 'u',
            category: 'Matériaux'
        });
    }

    // ---- Main d'œuvre ----
    if (calc.labor && vars.surface > 0) {
        const rendement = calc.labor.rendementParHeure || 5;
        const heures = vars.surface / rendement;
        const tauxHoraire = calc.labor.tauxHoraireDefault || 45;

        // Cherche un service "main d'œuvre" existant dans le catalogue
        const mainOeuvreService = userServices.find(s =>
            s.isLabor ||
            (s.name || '').toLowerCase().includes('main') ||
            (s.name || '').toLowerCase().includes('heure')
        );

        const refMOLabel = mainOeuvreService
            ? mainOeuvreService.name
            : `Main d'œuvre - ${calc.label || jobKey}`;
        const refMO = mainOeuvreService ? mainOeuvreService.ref : null;
        const prixMO = mainOeuvreService ? mainOeuvreService.unitPrice : tauxHoraire;

        items.push({
            ref: refMO || 'MO-' + jobKey.toUpperCase().slice(0, 5),
            name: refMOLabel,
            qty: parseFloat(heures.toFixed(2)),
            unitPrice: parseFloat(prixMO),
            total: parseFloat((heures * prixMO).toFixed(2)),
            unit: 'h',
            category: "Main d'œuvre"
        });

        logs.push(`⏱️ ${heures.toFixed(2)} h × ${prixMO}€/h = ${(heures * prixMO).toFixed(2)}€`);
    }

    // ---- Totaux ----
    const subtotal = items.reduce((sum, it) => sum + it.total, 0);
    const vatAmount = vatRegime === 'assujetti' ? subtotal * (vatRate / 100) : 0;
    const total = subtotal + vatAmount;

    return {
        items,
        logs,
        subtotal: parseFloat(subtotal.toFixed(2)),
        vatAmount: parseFloat(vatAmount.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        surface: vars.surface,
        heures: items
            .filter(i => i.category === "Main d'œuvre")
            .reduce((s, i) => s + i.qty, 0)
    };
}

// ------------------------------------------------------------
// Point d'entrée : calcule un devis depuis un texte libre
// ------------------------------------------------------------
async function calculateFromText(
    text,
    userProducts = [],
    userServices = [],
    vatRegime = 'franchise',
    vatRate = 21
) {
    const jobKey = detectJob(text);
    if (!jobKey) {
        return {
            success: false,
            error: 'Aucun métier reconnu dans la description. Précisez le type de travaux (peinture, placo, carrelage, parquet, maçonnerie, électricité, plomberie, toiture, isolation, terrassement).'
        };
    }

    const dimensions = extractDimensions(text);

    if (dimensions.surface === 0 && dimensions.longueur === 0 && dimensions.quantite === 1) {
        return {
            success: false,
            error: 'Impossible de détecter des dimensions dans la description. Précisez par exemple "3m x 2.5m" ou "30 m²".'
        };
    }

    try {
        const result = await calculateQuote(
            jobKey,
            dimensions,
            userProducts,
            userServices,
            vatRegime,
            vatRate
        );
        return {
            success: true,
            jobKey,
            jobLabel: CALCULATORS[jobKey].label || jobKey,
            dimensions,
            ...result
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    }
}

module.exports = {
    CALCULATORS,
    detectJob,
    extractDimensions,
    evaluateFormula,
    roundQuantity,
    calculateQuote,
    calculateFromText
};