// backend/utils/assistant/metiers.js
// Base de règles métier pour le calcul de devis
// Chaque métier calcule : matériaux + temps de réalisation

// ------------------------------------------------------------
// UTILITAIRES
// ------------------------------------------------------------
function roundUp(n, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.ceil(n * factor) / factor;
}

// Cherche un nombre dans le texte proche d'un mot-clé
function findNumber(text, keywords) {
    for (const kw of keywords) {
        const regex = new RegExp(`(\\d+[.,]?\\d*)\\s*(?:m|mètres?|metres?)?\\s*(?:de\\s+|x\\s+|par\\s+|sur\\s+)?${kw}`, 'i');
        const match = text.match(regex);
        if (match) return parseFloat(match[1].replace(',', '.'));
    }
    return null;
}

// Extrait toutes les dimensions (longueur x largeur) du texte
// function extractDimensions(text) {
//     // Pattern : "3m x 2.5m" ou "3 x 2.5" ou "3mx2,5m"
//     const patterns = [
//         /(\d+[.,]?\d*)\s*m?\s*[x×par]\s*(\d+[.,]?\d*)\s*m?/gi,
//         /(\d+[.,]?\d*)\s*(?:m|mètres?)\s*(?:sur|x|par)\s*(\d+[.,]?\d*)/gi,
//     ];
//     const dims = [];
//     for (const pattern of patterns) {
//         let match;
//         while ((match = pattern.exec(text)) !== null) {
//             dims.push({
//                 length: parseFloat(match[1].replace(',', '.')),
//                 width: parseFloat(match[2].replace(',', '.'))
//             });
//         }
//     }
//     return dims;
// }
// Extrait toutes les dimensions (longueur x largeur) du texte
// Version corrigée : évite les doublons et les bugs de lastIndex
function extractDimensions(text) {
    // Un seul pattern, qui gère à la fois "x", "×", "par", "sur"
    // et l'ordre "3m x 2.5m" ou "3 x 2.5"
    const regex = /(\d+(?:[.,]\d+)?)\s*(?:m|mètres?|metres?)?\s*(?:x|×|par|sur)\s*(\d+(?:[.,]\d+)?)\s*(?:m|mètres?|metres?)?/gi;
    
    const dims = [];
    const seen = new Set(); // Pour dédupliquer
    let match;
    
    // Reset lastIndex au cas où (sécurité)
    regex.lastIndex = 0;
    
    while ((match = regex.exec(text)) !== null) {
        const length = parseFloat(match[1].replace(',', '.'));
        const width = parseFloat(match[2].replace(',', '.'));
        
        // Éviter les doublons (ex: "3x2.5" détecté deux fois)
        const key = `${length}x${width}`;
        if (!seen.has(key)) {
            seen.add(key);
            dims.push({ length, width });
        }
        
        // Éviter les boucles infinies si le match est vide
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
    }
    
    return dims;
}

// Extrait une quantité simple (ex: "5 murs", "3 pièces")
function extractCount(text, keywords) {
    for (const kw of keywords) {
        const regex = new RegExp(`(\\d+)\\s*(?:${kw})`, 'i');
        const match = text.match(regex);
        if (match) return parseInt(match[1]);
    }
    return 1; // Par défaut 1
}

// ============================================================
// MÉTIER 1 : PEINTURE
// ============================================================
const peinture = {
    name: 'Peinture',
    keywords: ['peinture', 'peindre', 'peins', 'peint', 'badigeon', 'sous-couche', 'enduit', 'vernis'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);
        const count = extractCount(text, ['murs?', 'pièces?', 'chambres?', 'surfaces?']);
        const nbCouches = parseInt(text.match(/(\d+)\s*couches?/i)?.[1]) || 2;

        // Calcul surface totale
        // let surface = 0;
        // if (dims.length > 0) {
        //     dims.forEach(d => {
        //         surface += d.length * d.width;
        //     });
        //     logs.push(`📐 Dimensions détectées : ${dims.map(d => d.length + 'x' + d.width).join(', ')}`);
        // } else {
        //     // Chercher une surface directement
        //     const directSurface = findNumber(text, ['m2', 'm²', 'mètres carrés', 'metres carres']);
        //     if (directSurface) {
        //         surface = directSurface;
        //         logs.push(`📐 Surface détectée directement : ${surface} m²`);
        //     } else {
        //         // Valeur par défaut
        //         surface = 30;
        //         logs.push(`⚠️ Aucune dimension trouvée, surface par défaut : 30 m²`);
        //     }
        // }
        // if (dims.length > 0 && count > 1) {
        //     surface = surface * count;
        //     logs.push(`🔄 ${count} fois la surface = ${surface} m² total`);
        // }
        // Détecter ce qu'on peint : murs, plafond, ou les deux
        const isMurs = /murs?|parois|cloisons?/i.test(text);
        const isPlafond = /plafond|plafonds/i.test(text);
        const isSol = /sol|sols/i.test(text);
        const hauteurDefaut = 2.5; // hauteur standard d'une pièce

        // Calcul surface totale
        let surface = 0;
        // Détecte si l'utilisateur a donné un nombre explicite de murs
        const explicitWallsCount = count > 1 ? count : null;

        if (dims.length > 0) {
            if (isMurs && !isPlafond) {
                dims.forEach(d => {
                    const cote1 = d.length;
                    const cote2 = d.width;
                    const grand = Math.max(cote1, cote2);
                    const petit = Math.min(cote1, cote2);

                    if (explicitWallsCount && explicitWallsCount >= 2) {
                        // "N murs de X sur Y" : N murs individuels de X × Y
                        // Le plus petit côté est la hauteur, le plus grand la longueur
                        surface += grand * petit;
                        logs.push(`📐 ${explicitWallsCount} murs de ${grand}m × ${petit}m`);
                    } else {
                        // "les murs de la pièce" : périmètre × hauteur
                        const perimetre = (cote1 + cote2) * 2;
                        const hauteurFinale = (petit <= 3.5) ? petit : hauteurDefaut;
                        surface += perimetre * hauteurFinale;
                        logs.push(`📐 Pièce ${cote1}×${cote2}m : périmètre × ${hauteurFinale}m`);
                    }
                });

                if (explicitWallsCount && explicitWallsCount >= 2) {
                    surface = surface * explicitWallsCount;
                    logs.push(`🔄 × ${explicitWallsCount} murs = ${surface} m² total`);
                }
            } else if (isPlafond && !isMurs) {
                dims.forEach(d => { surface += d.length * d.width; });
                logs.push(`📐 Plafond : ${dims.map(d => `${d.length}×${d.width}m`).join(', ')}`);
                if (count > 1) {
                    surface *= count;
                    logs.push(`🔄 × ${count} plafonds = ${surface} m²`);
                }
            } else if (isMurs && isPlafond) {
                dims.forEach(d => {
                    const cote1 = d.length;
                    const cote2 = d.width;
                    const grand = Math.max(cote1, cote2);
                    const petit = Math.min(cote1, cote2);

                    if (explicitWallsCount && explicitWallsCount >= 2) {
                        surface += grand * petit; // murs
                    } else {
                        const perimetre = (cote1 + cote2) * 2;
                        const hauteurFinale = (petit <= 3.5) ? petit : hauteurDefaut;
                        surface += perimetre * hauteurFinale; // murs
                    }
                    surface += d.length * d.width; // plafond
                });
                if (explicitWallsCount && explicitWallsCount >= 2) surface *= explicitWallsCount;
                logs.push(`📐 Murs + plafond : ${surface} m² total`);
            } else {
                // Par défaut : surface au sol
                dims.forEach(d => { surface += d.length * d.width; });
                if (count > 1) surface *= count;
                logs.push(`📐 Surface au sol : ${surface} m²`);
            }
        } else {
            const directSurface = findNumber(text, ['m2', 'm²', 'mètres carrés', 'metres carres']);
            if (directSurface) {
                surface = directSurface;
                logs.push(`📐 Surface détectée directement : ${surface} m²`);
            } else {
                surface = 30;
                logs.push(`⚠️ Aucune dimension trouvée, surface par défaut : 30 m²`);
            }
        }

        // ⚠️ SUPPRIME le bloc suivant s'il existe :
        // if (dims.length > 0 && count > 1) {
        //     surface = surface * count;
        //     logs.push(`🔄 ${count} fois la surface = ${surface} m² total`);
        // }
        // let surface = 0;
        // if (dims.length > 0) {
        //     if (isMurs && !isPlafond) {
        //         // On peint UNIQUEMENT les murs.
        //         // Convention : "3 murs de 3m sur 2.5m" = 3 murs de 3m de long sur 2.5m de haut
        //         // → surface = longueur × hauteur × nb murs
        //         dims.forEach(d => {
        //             // Si la 2e dimension ressemble à une hauteur (≤ 3.5m), on l'utilise comme hauteur
        //             const longueur = Math.max(d.length, d.width);
        //             const hauteur = Math.min(d.length, d.width);
        //             const hauteurFinale = (hauteur <= 3.5) ? hauteur : hauteurDefaut;
        //             surface += longueur * hauteurFinale;
        //         });
        //         logs.push(`📐 Murs à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')} → longueur × hauteur`);
        //     } else if (isPlafond && !isMurs) {
        //         // inchangé
        //         dims.forEach(d => { surface += d.length * d.width; });
        //         logs.push(`📐 Plafond à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')}`);
        //     } else if (isMurs && isPlafond) {
        //         // Murs + plafond : murs (longueur × hauteur) + plafond (surface)
        //         dims.forEach(d => {
        //             const longueur = Math.max(d.length, d.width);
        //             const hauteur = Math.min(d.length, d.width);
        //             const hauteurFinale = (hauteur <= 3.5) ? hauteur : hauteurDefaut;
        //             surface += longueur * hauteurFinale; // murs
        //             surface += d.length * d.width;       // plafond
        //         });
        //         logs.push(`📐 Murs + plafond à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')}`);
        //     } else {
        //         // inchangé (par défaut, surface au sol)
        //         dims.forEach(d => { surface += d.length * d.width; });
        //         logs.push(`📐 Dimensions détectées : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')}`);
        //     }
        //     // if (isMurs && !isPlafond) {
        //     //     // On peint UNIQUEMENT les murs : périmètre × hauteur
        //     //     dims.forEach(d => {
        //     //         const perimetre = (d.length + d.width) * 2;
        //     //         surface += perimetre * hauteurDefaut;
        //     //     });
        //     //     logs.push(`📐 Murs à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')} → périmètre × ${hauteurDefaut}m de hauteur`);
        //     // } else if (isPlafond && !isMurs) {
        //     //     // On peint UNIQUEMENT le plafond : surface au sol
        //     //     dims.forEach(d => {
        //     //         surface += d.length * d.width;
        //     //     });
        //     //     logs.push(`📐 Plafond à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')}`);
        //     // } else if (isMurs && isPlafond) {
        //     //     // On peint murs ET plafond
        //     //     dims.forEach(d => {
        //     //         const perimetre = (d.length + d.width) * 2;
        //     //         surface += perimetre * hauteurDefaut; // murs
        //     //         surface += d.length * d.width;          // plafond
        //     //     });
        //     //     logs.push(`📐 Murs + plafond à peindre : ${dims.map(d => `${d.length}x${d.width}m`).join(', ')}`);
        // } else {
        //     // Chercher une surface directement
        //     const directSurface = findNumber(text, ['m2', 'm²', 'mètres carrés', 'metres carres']);
        //     if (directSurface) {
        //         surface = directSurface;
        //         logs.push(`📐 Surface détectée directement : ${surface} m²`);
        //     } else {
        //         // Valeur par défaut
        //         surface = 30;
        //         logs.push(`⚠️ Aucune dimension trouvée, surface par défaut : 30 m²`);
        //     }
        // }

        // if (dims.length > 0 && count > 1) {
        //     surface = surface * count;
        //     logs.push(`🔄 ${count} fois la surface = ${surface} m² total`);
        // }

        // Rendement : ~10 m²/L par couche
        const litresParCouche = surface / 10;
        const litresTotal = roundUp(litresParCouche * nbCouches, 2);
        logs.push(`🎨 ${litresTotal} L de peinture (${nbCouches} couches × ${roundUp(litresParCouche, 2)} L)`);

        // Temps de réalisation : ~8 m²/h (préparation + 1 couche)
        //const heures = roundUp(surface / 8 * nbCouches, 2);
        // 6 m²/h tout compris (préparation + impression + 2 couches + finitions)
        // Source : 1 peintre professionnel fait 40-50 m²/jour en 2 couches
        const heures = roundUp(surface / 6, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        // Construire les items
        const items = [];
        // Chercher peinture dans le catalogue
        const peintureProduit = products.find(p =>
            p.name.toLowerCase().includes('peinture') ||
            p.name.toLowerCase().includes('acrylique') ||
            p.name.toLowerCase().includes('mate')
        );
        if (peintureProduit) {
            const qty = Math.ceil(litresTotal / 5); // Pots de 5L
            items.push({
                ref: peintureProduit.ref,
                name: peintureProduit.name + ` (${litresTotal} L, pots de 5L)`,
                qty: qty,
                unitPrice: peintureProduit.unitPrice,
                total: qty * peintureProduit.unitPrice
            });
        } else {
            items.push({
                ref: 'EXT-PEINT',
                name: `Peinture acrylique (${litresTotal} L)`,
                qty: Math.ceil(litresTotal / 5),
                unitPrice: 45,
                total: Math.ceil(litresTotal / 5) * 45
            });
        }

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-PEINT',
            name: `Main d'œuvre peinture (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 2 : PLAQUE DE PLÂTRE / CLOISONS
// ============================================================
const placo = {
    name: 'Cloison placo',
    keywords: ['placo', 'placoplatre', 'plaque de platre', 'cloison', 'cloison sèche', 'ba13', 'doublage'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);
        const count = extractCount(text, ['cloisons?', 'murs?', 'pièces?']);

        // Surface de cloison
        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => {
                surface += d.length * d.width;
            });
        } else {
            surface = 15;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 15 m²`);
        }
        if (count > 1) surface *= count;

        logs.push(`📐 Surface totale : ${roundUp(surface, 2)} m²`);

        // Calculs matériaux pour cloison 72/48 (plaque BA13 chaque face)
        const hauteurStandard = 2.5;
        const surfacePlaque = 2.5 * 1.2; // 3 m² par plaque
        const nbPlaquesParFace = Math.ceil(surface / surfacePlaque);
        const nbPlaquesTotal = nbPlaquesParFace * 2; // 2 faces

        // Rails et montants (ossature métallique) tous les 60 cm
        const longueurCloison = dims[0]?.length || 5;
        const nbMontants = Math.ceil(longueurCloison / 0.6) + 1;
        const nbRails = 2; // haut et bas
        const longueurRail = longueurCloison * nbRails;

        // Isolant (laine de verre)
        const surfaceIsolant = surface;

        // Vis : ~30 vis/m²
        const nbVis = Math.ceil(surface * 30);

        // Bande à joint : ~1.2 m/m²
        const mlBande = roundUp(surface * 1.2, 2);

        // Enduit : ~0.5 kg/m²
        const kgEnduit = roundUp(surface * 0.5, 2);

        logs.push(`📋 Matériaux calculés : ${nbPlaquesTotal} plaques BA13, ${nbMontants} montants, ${roundUp(longueurRail, 1)} ml rails, ${roundUp(surfaceIsolant, 1)} m² isolant, ${nbVis} vis, ${mlBande} ml bande, ${kgEnduit} kg enduit`);

        // Temps : ~1.5 h/m² (montage + joint + finition)
        //const heures = roundUp(surface * 1.5, 2);
        // 1.2 h/m² : pose ossature + plaques + bandes + enduit + ponçage (2 faces)
        const heures = roundUp(surface * 1.2, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];
        // Plaques
        const plaqueProduit = products.find(p => p.name.toLowerCase().includes('plaque') || p.name.toLowerCase().includes('ba13'));
        items.push({
            ref: plaqueProduit?.ref || 'EXT-PLAQUE',
            name: plaqueProduit?.name || 'Plaque de plâtre BA13 (2.5x1.2m)',
            qty: nbPlaquesTotal,
            unitPrice: plaqueProduit?.unitPrice || 8.50,
            total: nbPlaquesTotal * (plaqueProduit?.unitPrice || 8.50)
        });

        // Montants
        const montantProduit = products.find(p => p.name.toLowerCase().includes('montant'));
        items.push({
            ref: montantProduit?.ref || 'EXT-MONT',
            name: montantProduit?.name || 'Montant métallique 48mm (3m)',
            qty: nbMontants,
            unitPrice: montantProduit?.unitPrice || 4.20,
            total: nbMontants * (montantProduit?.unitPrice || 4.20)
        });

        // Rails
        items.push({
            ref: 'EXT-RAIL',
            name: `Rail métallique 48mm (${roundUp(longueurRail, 1)} ml)`,
            qty: Math.ceil(longueurRail / 3),
            unitPrice: 4.50,
            total: Math.ceil(longueurRail / 3) * 4.50
        });

        // Isolant
        const isolantProduit = products.find(p => p.name.toLowerCase().includes('isolant') || p.name.toLowerCase().includes('laine'));
        items.push({
            ref: isolantProduit?.ref || 'EXT-ISO',
            name: isolantProduit?.name || `Laine de verre (${roundUp(surfaceIsolant, 1)} m²)`,
            qty: Math.ceil(surfaceIsolant),
            unitPrice: isolantProduit?.unitPrice || 6.50,
            total: Math.ceil(surfaceIsolant) * (isolantProduit?.unitPrice || 6.50)
        });

        // Vis
        items.push({
            ref: 'EXT-VIS',
            name: `Vis TTPC placo (${nbVis} pièces)`,
            qty: Math.ceil(nbVis / 1000) || 1,
            unitPrice: 12,
            total: (Math.ceil(nbVis / 1000) || 1) * 12
        });

        // Bande + enduit (forfait finition)
        items.push({
            ref: 'EXT-FINIT',
            name: `Bande à joint (${mlBande} ml) + enduit (${kgEnduit} kg)`,
            qty: 1,
            unitPrice: roundUp(mlBande * 0.5 + kgEnduit * 2, 2),
            total: roundUp(mlBande * 0.5 + kgEnduit * 2, 2)
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-PLACO',
            name: `Main d'œuvre placo (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 3 : PLAFOND SUSPENDU
// ============================================================
const plafond = {
    name: 'Plafond suspendu',
        keywords: ['plafond suspendu', 'faux plafond', 'plafond en placo', 'plafond ba13', 'plafond dalles', 'suspendu'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => { surface += d.length * d.width; });
        } else {
            surface = 20;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 20 m²`);
        }
        logs.push(`📐 Surface plafond : ${roundUp(surface, 2)} m²`);

        // Plaques (mêmes plaques BA13 que placo)
        const surfacePlaque = 3;
        const nbPlaques = Math.ceil(surface / surfacePlaque);

        // Fourrures (F530) : tous les 60 cm
        const nbFourrures = Math.ceil(surface / (1.2 * 0.6));
        const mlFourrures = roundUp(nbFourrures * 3, 1);

        // Suspentes : 1 tous les 1.2 m² (soit ~0.9 par m²)
        const nbSuspentes = Math.ceil(surface * 0.9);

        // Rails périphériques (fourrure de rive) : périmètre
        const perimetre = dims.length > 0 ? dims[0].length * 2 + dims[0].width * 2 : 20;
        const mlRails = roundUp(perimetre, 1);

        // Vis
        const nbVis = Math.ceil(surface * 30);

        // Bande à joint + enduit
        const mlBande = roundUp(surface * 1.2, 2);
        const kgEnduit = roundUp(surface * 0.5, 2);

        logs.push(`📋 ${nbPlaques} plaques, ${nbSuspentes} suspentes, ${mlFourrures} ml fourrures, ${mlRails} ml rails, ${nbVis} vis`);

        // Temps : ~2 h/m² (pose + finition plafond plus délicat)
        //const heures = roundUp(surface * 2, 2);
        // 1.2 h/m² : pose + bandes + enduit (un plafond, c'est plus rapide qu'une cloison)
        const heures = roundUp(surface * 1.2, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        // Plaques
        items.push({
            ref: 'EXT-PLAQUE',
            name: 'Plaque de plâtre BA13 (2.5x1.2m)',
            qty: nbPlaques,
            unitPrice: 8.50,
            total: nbPlaques * 8.50
        });

        // Fourrures
        items.push({
            ref: 'EXT-FOURR',
            name: `Fourrure F530 (${mlFourrures} ml)`,
            qty: Math.ceil(mlFourrures / 3),
            unitPrice: 5.20,
            total: Math.ceil(mlFourrures / 3) * 5.20
        });

        // Suspentes
        items.push({
            ref: 'EXT-SUSP',
            name: `Suspentes réglables (${nbSuspentes} pièces)`,
            qty: nbSuspentes,
            unitPrice: 0.85,
            total: roundUp(nbSuspentes * 0.85, 2)
        });

        // Rails périphériques
        items.push({
            ref: 'EXT-RAIL-RIVE',
            name: `Rail de rive (${mlRails} ml)`,
            qty: Math.ceil(mlRails / 3),
            unitPrice: 4.50,
            total: Math.ceil(mlRails / 3) * 4.50
        });

        // Vis
        items.push({
            ref: 'EXT-VIS',
            name: `Vis placo (${nbVis} pièces)`,
            qty: Math.ceil(nbVis / 1000) || 1,
            unitPrice: 12,
            total: (Math.ceil(nbVis / 1000) || 1) * 12
        });

        // Finition
        items.push({
            ref: 'EXT-FINIT',
            name: `Bande + enduit (${mlBande} ml / ${kgEnduit} kg)`,
            qty: 1,
            unitPrice: roundUp(mlBande * 0.5 + kgEnduit * 2, 2),
            total: roundUp(mlBande * 0.5 + kgEnduit * 2, 2)
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-PLAFOND',
            name: `Main d'œuvre plafond suspendu (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 4 : CARRELAGE
// ============================================================
const carrelage = {
    name: 'Carrelage',
    keywords: ['carrelage', 'carreler', 'carrelé', 'carreaux', 'faïence', 'faience', 'mosaïque'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => { surface += d.length * d.width; });
        } else {
            surface = 15;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 15 m²`);
        }

        // Ajout 10% de pertes (coupes)
        const surfaceAvecPertes = roundUp(surface * 1.10, 2);
        logs.push(`📐 Surface brute : ${surface} m², avec pertes 10% : ${surfaceAvecPertes} m²`);

        // Colle : ~4 kg/m²
        const kgColle = Math.ceil(surfaceAvecPertes * 4);
        const nbSacsColle = Math.ceil(kgColle / 25); // Sacs de 25 kg

        // Joint : ~0.5 kg/m²
        const kgJoint = roundUp(surfaceAvecPertes * 0.5, 1);

        // Croisillons : ~30/m²
        const nbCroisillons = Math.ceil(surfaceAvecPertes * 30);

        logs.push(`📋 ${surfaceAvecPertes} m² carrelage, ${nbSacsColle} sacs colle, ${kgJoint} kg joint, ${nbCroisillons} croisillons`);

        // Temps : ~1 h/m² pose (sol), 1.2 h/m² (mur)
        //const heures = roundUp(surfaceAvecPertes * 1, 2);
        // 1.2 h/m² : pose + joints (murs ou sol, moyenne)
        const heures = roundUp(surfaceAvecPertes * 1.2, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        // Carrelage
        const carrelageProduit = products.find(p => p.name.toLowerCase().includes('carrelage') || p.name.toLowerCase().includes('carreau'));
        items.push({
            ref: carrelageProduit?.ref || 'EXT-CARR',
            name: carrelageProduit?.name || `Carrelage (${surfaceAvecPertes} m²)`,
            qty: surfaceAvecPertes,
            unitPrice: carrelageProduit?.unitPrice || 25,
            total: roundUp(surfaceAvecPertes * (carrelageProduit?.unitPrice || 25), 2)
        });

        // Colle
        items.push({
            ref: 'EXT-COLLE',
            name: `Colle carrelage (${nbSacsColle} sacs de 25 kg)`,
            qty: nbSacsColle,
            unitPrice: 14,
            total: nbSacsColle * 14
        });

        // Joint
        items.push({
            ref: 'EXT-JOINT',
            name: `Joint carrelage (${kgJoint} kg)`,
            qty: Math.ceil(kgJoint / 5),
            unitPrice: 8,
            total: Math.ceil(kgJoint / 5) * 8
        });

        // Croisillons
        items.push({
            ref: 'EXT-CROIS',
            name: `Croisillons (${nbCroisillons} pièces)`,
            qty: Math.ceil(nbCroisillons / 200) || 1,
            unitPrice: 5,
            total: (Math.ceil(nbCroisillons / 200) || 1) * 5
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-CARR',
            name: `Main d'œuvre carrelage (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 5 : PARQUET
// ============================================================
const parquet = {
    name: 'Parquet',
    keywords: ['parquet', 'parqueter', 'laminé', 'lamine', 'stratifié', 'stratifie', 'sol bois'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => { surface += d.length * d.width; });
        } else {
            surface = 20;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 20 m²`);
        }

        // Pertes 7% (parquet moins de coupes que carrelage)
        const surfaceAvecPertes = roundUp(surface * 1.07, 2);
        logs.push(`📐 Surface brute : ${surface} m², avec pertes 7% : ${surfaceAvecPertes} m²`);

        // Sous-couche
        const surfaceSousCouche = roundUp(surface, 2);

        // Plinthes : périmètre - ouvertures (par défaut on prend 1ml/m²)
        const mlPlinthes = roundUp(surface * 0.9, 1);

        // Colle ou clips (parquet flottant) : ~30/m² si clips
        const nbClips = Math.ceil(surface * 30);

        logs.push(`📋 ${surfaceAvecPertes} m² parquet, ${surfaceSousCouche} m² sous-couche, ${mlPlinthes} ml plinthes, ${nbClips} clips`);

        // Temps : ~0.8 h/m² (parquet flottant plus rapide)
        //const heures = roundUp(surface * 0.8, 2);
        // 0.7 h/m² : pose flottante rapide
        const heures = roundUp(surface * 0.7, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        // Parquet
        const parquetProduit = products.find(p => p.name.toLowerCase().includes('parquet') || p.name.toLowerCase().includes('laminé'));
        items.push({
            ref: parquetProduit?.ref || 'EXT-PARQ',
            name: parquetProduit?.name || `Parquet (${surfaceAvecPertes} m²)`,
            qty: surfaceAvecPertes,
            unitPrice: parquetProduit?.unitPrice || 30,
            total: roundUp(surfaceAvecPertes * (parquetProduit?.unitPrice || 30), 2)
        });

        // Sous-couche
        items.push({
            ref: 'EXT-SOUSC',
            name: `Sous-couche isolante (${surfaceSousCouche} m²)`,
            qty: surfaceSousCouche,
            unitPrice: 3.50,
            total: roundUp(surfaceSousCouche * 3.50, 2)
        });

        // Plinthes
        items.push({
            ref: 'EXT-PLINTHE',
            name: `Plinthes (${mlPlinthes} ml)`,
            qty: Math.ceil(mlPlinthes / 2.4),
            unitPrice: 6,
            total: Math.ceil(mlPlinthes / 2.4) * 6
        });

        // Clips
        items.push({
            ref: 'EXT-CLIPS',
            name: `Clips de fixation (${nbClips} pièces)`,
            qty: Math.ceil(nbClips / 100),
            unitPrice: 4,
            total: Math.ceil(nbClips / 100) * 4
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-PARQ',
            name: `Main d'œuvre parquet (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 6 : MAÇONNERIE / MUR BRIQUE
// ============================================================
const maconnerie = {
    name: 'Maçonnerie',
        keywords: ['maçonnerie', 'maconnerie', 'mur en brique', 'mur en parpaing', 'parpaing', 'bloc béton', 'bloc beton', 'dalle béton', 'dalle beton', 'élévation', 'elevation'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        let epaisseur = 0.20; // 20 cm par défaut

        if (dims.length > 0) {
            surface = dims[0].length * dims[0].width;
        } else {
            surface = 10;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 10 m²`);
        }
        logs.push(`📐 Surface mur : ${roundUp(surface, 2)} m²`);

        // Parpaings de 20x20x50 : ~12.5 parpaings/m²
        const nbParpaings = Math.ceil(surface * 12.5);

        // Ciment : ~35 kg/m²
        const kgCiment = Math.ceil(surface * 35);
        const nbSacsCiment = Math.ceil(kgCiment / 35); // Sacs de 35 kg

        // Sable : ~0.02 m³/m² (soit ~30 kg)
        const kgSable = Math.ceil(surface * 30);

        // Treillis (si dalle) : 1m²/m²
        const nbTreillis = Math.ceil(surface);

        logs.push(`📋 ${nbParpaings} parpaings, ${nbSacsCiment} sacs ciment, ${kgSable} kg sable`);

        // Temps : ~1.2 h/m² (mur porteur)
        //const heures = roundUp(surface * 1.2, 2);
        // 1.5 h/m² : montage mur + joints + finitions
        const heures = roundUp(surface * 1.5, 2);   
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        // Parpaings
        items.push({
            ref: 'EXT-PARPAING',
            name: `Parpaing 20x20x50 (${nbParpaings} pièces)`,
            qty: nbParpaings,
            unitPrice: 1.80,
            total: roundUp(nbParpaings * 1.80, 2)
        });

        // Ciment
        items.push({
            ref: 'EXT-CIMENT',
            name: `Ciment (${nbSacsCiment} sacs de 35 kg)`,
            qty: nbSacsCiment,
            unitPrice: 8,
            total: nbSacsCiment * 8
        });

        // Sable
        items.push({
            ref: 'EXT-SABLE',
            name: `Sable (${kgSable} kg)`,
            qty: Math.ceil(kgSable / 25),
            unitPrice: 4,
            total: Math.ceil(kgSable / 25) * 4
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-MACON',
            name: `Main d'œuvre maçonnerie (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 7 : ÉLECTRICITÉ (basique)
// ============================================================
const electricite = {
    name: 'Électricité',
    keywords: ['électricité', 'electricite', 'prise', 'interrupteur', 'câble', 'cable', 'tableau', 'disjoncteur'],
    async compute(text, products, services) {
        const logs = [];

        // Extraction des quantités spécifiques
        const nbPrises = parseInt(text.match(/(\d+)\s*prises?/i)?.[1]) || 0;
        const nbInterrupteurs = parseInt(text.match(/(\d+)\s*(?:interrupteurs?|points? lumineux)/i)?.[1]) || 0;
        const nbTableaux = parseInt(text.match(/(\d+)\s*tableaux?/i)?.[1]) || 0;
        const mlCables = parseInt(text.match(/(\d+)\s*(?:m|mètres?|ml)\s*(?:de\s+)?c[aâ]bles?/i)?.[1]) || 0;

        // Si aucune détection, estimations par défaut
        if (nbPrises === 0 && nbInterrupteurs === 0 && nbTableaux === 0 && mlCables === 0) {
            logs.push(`⚠️ Aucune quantité détectée, valeurs par défaut utilisées.`);
        }

        const items = [];

        if (nbPrises > 0) {
            items.push({
                ref: 'EXT-PRISE',
                name: `Prise électrique encastrée`,
                qty: nbPrises,
                unitPrice: 12,
                total: nbPrises * 12
            });
            logs.push(`🔌 ${nbPrises} prises détectées`);
        }

        if (nbInterrupteurs > 0) {
            items.push({
                ref: 'EXT-INTER',
                name: `Interrupteur / point lumineux`,
                qty: nbInterrupteurs,
                unitPrice: 15,
                total: nbInterrupteurs * 15
            });
            logs.push(`💡 ${nbInterrupteurs} interrupteurs détectés`);
        }

        if (nbTableaux > 0) {
            items.push({
                ref: 'EXT-TABLO',
                name: `Tableau électrique`,
                qty: nbTableaux,
                unitPrice: 350,
                total: nbTableaux * 350
            });
            logs.push(`⚡ ${nbTableaux} tableau(x) détecté(s)`);
        }

        if (mlCables > 0) {
            items.push({
                ref: 'EXT-CABLE',
                name: `Câble électrique (${mlCables} ml)`,
                qty: Math.ceil(mlCables / 100),
                unitPrice: 45,
                total: Math.ceil(mlCables / 100) * 45
            });
            logs.push(`🔌 ${mlCables} ml de câble`);
        }

        // Main d'œuvre : ~1h par prise + 0.5h par interrupteur + 4h par tableau
        const heures = roundUp(nbPrises * 1 + nbInterrupteurs * 0.5 + nbTableaux * 4 + mlCables * 0.05, 2) || 4;
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 55;
        items.push({
            ref: 'MO-ELEC',
            name: `Main d'œuvre électricité (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, heures };
    }
};

// ============================================================
// MÉTIER 8 : PLOMBERIE (basique)
// ============================================================
const plomberie = {
    name: 'Plomberie',
    keywords: ['plomberie', 'plombier', 'tuyau', 'tuyauterie', 'robinet', 'sanitaire', 'wc', 'lavabo', 'douche', 'évier', 'evier'],
    async compute(text, products, services) {
        const logs = [];

        const nbWC = parseInt(text.match(/(\d+)\s*wc/gi)?.[1]) || 0;
        const nbLavabos = parseInt(text.match(/(\d+)\s*(?:lavabos?|vasques?|éviers?|eviers?)/gi)?.[1]) || 0;
        const nbDouches = parseInt(text.match(/(\d+)\s*(?:douches?|baignoires?)/gi)?.[1]) || 0;
        const mlTuyaux = parseInt(text.match(/(\d+)\s*(?:m|mètres?|ml)\s*(?:de\s+)?(?:tuyaux?|tuyauterie)/gi)?.[1]) || 0;

        if (nbWC === 0 && nbLavabos === 0 && nbDouches === 0 && mlTuyaux === 0) {
            logs.push(`⚠️ Aucune quantité détectée, valeurs par défaut utilisées.`);
        }

        const items = [];

        if (nbWC > 0) {
            items.push({
                ref: 'EXT-WC',
                name: `WC complet (cuvette + réservoir + mécanisme)`,
                qty: nbWC,
                unitPrice: 180,
                total: nbWC * 180
            });
            logs.push(`🚽 ${nbWC} WC détecté(s)`);
        }

        if (nbLavabos > 0) {
            items.push({
                ref: 'EXT-LAVABO',
                name: `Lavabo / vasque avec robinetterie`,
                qty: nbLavabos,
                unitPrice: 150,
                total: nbLavabos * 150
            });
            logs.push(`🚰 ${nbLavabos} lavabo(s) détecté(s)`);
        }

        if (nbDouches > 0) {
            items.push({
                ref: 'EXT-DOUCHE',
                name: `Ensemble douche / baignoire`,
                qty: nbDouches,
                unitPrice: 320,
                total: nbDouches * 320
            });
            logs.push(`🚿 ${nbDouches} douche(s) détectée(s)`);
        }

        if (mlTuyaux > 0) {
            items.push({
                ref: 'EXT-TUYAU',
                name: `Tuyauterie PER / cuivre (${mlTuyaux} ml)`,
                qty: Math.ceil(mlTuyaux / 25),
                unitPrice: 28,
                total: Math.ceil(mlTuyaux / 25) * 28
            });
            logs.push(`🔧 ${mlTuyaux} ml de tuyauterie`);
        }

        // Main d'œuvre : ~2h par WC, 1.5h par lavabo, 2.5h par douche, 0.3h par ml
        const heures = roundUp(nbWC * 2 + nbLavabos * 1.5 + nbDouches * 2.5 + mlTuyaux * 0.3, 2) || 3;
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 55;
        items.push({
            ref: 'MO-PLOMB',
            name: `Main d'œuvre plomberie (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, heures };
    }
};

// ============================================================
// MÉTIER 9 : TOITURE (basique)
// ============================================================
const toiture = {
    name: 'Toiture',
    keywords: ['toiture', 'toit', 'tuile', 'tuiles', 'ardoise', 'faîtage', 'faitage', 'zinguerie', 'gouttière', 'gouttiere'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => { surface += d.length * d.width; });
        } else {
            surface = 40;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 40 m²`);
        }
        logs.push(`📐 Surface toiture : ${roundUp(surface, 2)} m²`);

        // Tuiles : ~12 tuiles/m² (tuile plate)
        const nbTuiles = Math.ceil(surface * 12);
        const nbTuilesAvecPertes = Math.ceil(nbTuiles * 1.05); // 5% de pertes

        // Liteaux / voliges (tous les 35cm)
        const mlLiteaux = roundUp(surface / 0.35 * 0.35, 1); // simplifié
        const nbLiteaux = Math.ceil(surface / 0.35 / 3) * 1; // en unités de 3m

        // Faîtage : périmètre approximatif
        const mlFaitage = roundUp(surface * 0.3, 1);

        // Gouttières : périmètre approximatif
        const mlGouttieres = roundUp(surface * 0.25, 1);

        logs.push(`📋 ${nbTuilesAvecPertes} tuiles, ${mlFaitage} ml faîtage, ${mlGouttieres} ml gouttières`);

        // Temps : ~0.8 h/m² (pose + finitions)
        //const heures = roundUp(surface * 0.8, 2);
        // 1.3 h/m² : dépose + pose tuiles + faîtage + gouttières
        const heures = roundUp(surface * 1.3, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        // Tuiles
        items.push({
            ref: 'EXT-TUILE',
            name: `Tuiles (${nbTuilesAvecPertes} pièces, +5% pertes)`,
            qty: Math.ceil(nbTuilesAvecPertes / 10),
            unitPrice: 15,
            total: Math.ceil(nbTuilesAvecPertes / 10) * 15
        });

        // Faîtage
        items.push({
            ref: 'EXT-FAITAGE',
            name: `Faîtage (${mlFaitage} ml)`,
            qty: Math.ceil(mlFaitage / 1.5),
            unitPrice: 12,
            total: Math.ceil(mlFaitage / 1.5) * 12
        });

        // Gouttières
        items.push({
            ref: 'EXT-GOUTT',
            name: `Gouttières (${mlGouttieres} ml)`,
            qty: Math.ceil(mlGouttieres / 3),
            unitPrice: 18,
            total: Math.ceil(mlGouttieres / 3) * 18
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 50;
        items.push({
            ref: 'MO-TOIT',
            name: `Main d'œuvre toiture (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 10 : ISOLATION
// ============================================================
const isolation = {
    name: 'Isolation',
        keywords: ['isolation', 'isoler', 'isolant', 'laine de verre', 'laine de roche', 'polystyrène', 'polystyrene', 'isolation combles', 'ite', 'iti'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let surface = 0;
        if (dims.length > 0) {
            dims.forEach(d => { surface += d.length * d.width; });
        } else {
            surface = 30;
            logs.push(`⚠️ Aucune dimension, surface par défaut : 30 m²`);
        }
        logs.push(`📐 Surface à isoler : ${roundUp(surface, 2)} m²`);

        // Type d'isolation
        const isCombles = /combles?/i.test(text);
        const isITE = /ite|extérieur|exterieur/i.test(text);
        const isITI = /iti|intérieur|interieur/i.test(text);

        let typeLabel = 'Isolation';
        if (isCombles) typeLabel = 'Combles';
        else if (isITE) typeLabel = 'ITE (extérieur)';
        else if (isITI) typeLabel = 'ITI (intérieur)';

        // Épaisseur selon le type (en cm)
        let epaisseur = 20;
        if (isCombles) epaisseur = 30;
        else if (isITE) epaisseur = 16;
        else if (isITI) epaisseur = 12;
        logs.push(`🔧 Type : ${typeLabel}, épaisseur ${epaisseur} cm`);

        // Quantité d'isolant (m²)
        const surfaceAvecPertes = roundUp(surface * 1.05, 2);

        // Temps : ~0.4 h/m²
        //const heures = roundUp(surface * 0.4, 2);
        // Combles : 0.3 h/m² | ITE : 0.6 h/m² | ITI : 0.5 h/m²
        let heures;
        if (isCombles) heures = roundUp(surface * 0.3, 2);
        else if (isITE) heures = roundUp(surface * 0.6, 2);
        else heures = roundUp(surface * 0.5, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        items.push({
            ref: 'EXT-ISOLANT',
            name: `Isolant ${typeLabel} (${epaisseur} cm, ${surfaceAvecPertes} m²)`,
            qty: Math.ceil(surfaceAvecPertes),
            unitPrice: isCombles ? 8 : (isITE ? 22 : 12),
            total: Math.ceil(surfaceAvecPertes) * (isCombles ? 8 : (isITE ? 22 : 12))
        });

        // Pare-vapeur
        items.push({
            ref: 'EXT-PAREVAP',
            name: `Pare-vapeur (${surfaceAvecPertes} m²)`,
            qty: Math.ceil(surfaceAvecPertes),
            unitPrice: 2.5,
            total: roundUp(surfaceAvecPertes * 2.5, 2)
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 45;
        items.push({
            ref: 'MO-ISO',
            name: `Main d'œuvre isolation (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, surface, heures };
    }
};

// ============================================================
// MÉTIER 11 : TERRASSEMENT / VRD
// ============================================================
const terrassement = {
    name: 'Terrassement',
    keywords: ['terrassement', 'terrasser', 'excavation', 'fouille', 'tranchée', 'tranchee', 'vrd', 'voirie', 'remblai'],
    async compute(text, products, services) {
        const logs = [];
        const dims = extractDimensions(text);

        let volume = 0;
        let surface = 0;

        // Chercher des m³
        const m3Match = text.match(/(\d+[.,]?\d*)\s*m3|m³/i);
        if (m3Match) {
            volume = parseFloat(m3Match[1].replace(',', '.'));
            logs.push(`📐 Volume détecté : ${volume} m³`);
        } else if (dims.length > 0) {
            // Longueur x largeur x profondeur (profondeur estimée 1m)
            surface = dims[0].length * dims[0].width;
            volume = surface * 1; // 1m de profondeur par défaut
            logs.push(`📐 Surface ${surface} m², profondeur estimée 1m → ${volume} m³`);
        } else {
            volume = 20;
            logs.push(`⚠️ Aucune dimension, volume par défaut : 20 m³`);
        }

        // Temps : ~0.5 h/m³ (pelle mécanique + main d'œuvre)
        //const heures = roundUp(volume * 0.5, 2);
        // 1.2 h/m³ : excavation + chargement + évacuation
        const heures = roundUp(volume * 1.2, 2);
        logs.push(`⏱️ Temps estimé : ${heures} h`);

        const items = [];

        items.push({
            ref: 'EXT-TERRASS',
            name: `Terrassement / excavation (${volume} m³)`,
            qty: volume,
            unitPrice: 45,
            total: roundUp(volume * 45, 2)
        });

        // Évacuation des terres
        items.push({
            ref: 'EXT-EVAC',
            name: `Évacuation des terres (${volume} m³)`,
            qty: volume,
            unitPrice: 25,
            total: roundUp(volume * 25, 2)
        });

        // Main d'œuvre
        const tauxHoraire = services.find(s => s.isLabor && s.unit === 'h')?.unitPrice || 60;
        items.push({
            ref: 'MO-TERRASS',
            name: `Main d'œuvre terrassement (${heures} h)`,
            qty: heures,
            unitPrice: tauxHoraire,
            total: roundUp(heures * tauxHoraire, 2)
        });

        return { items, logs, volume, heures };
    }
};

// ============================================================
// REGISTRE DES MÉTIERS
// ============================================================
const METIERS = [
    peinture,
    placo,
    plafond,
    carrelage,
    parquet,
    maconnerie,
    electricite,
    plomberie,
    toiture,
    isolation,
    terrassement
];

// ------------------------------------------------------------
// Détecte le métier à partir du texte
// ------------------------------------------------------------
function detecterMetier(text) {
    const lower = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const metier of METIERS) {
        let score = 0;
        for (const kw of metier.keywords) {
            if (lower.includes(kw.toLowerCase())) {
                // Mot-clé plus long = plus spécifique = score plus élevé
                score += kw.length;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = metier;
        }
    }

    return bestMatch;
}

// ------------------------------------------------------------
// Calcule un devis à partir d'une description texte
// ------------------------------------------------------------
async function calculerDevisDepuisTexte(text, products, services) {
    const metier = detecterMetier(text);

    if (!metier) {
        return {
            success: false,
            error: 'Aucun métier reconnu dans la description. Précisez le type de travaux (peinture, placo, carrelage, parquet, maçonnerie, électricité, plomberie, toiture, isolation, terrassement).'
        };
    }

    try {
        const result = await metier.compute(text, products, services);
        return {
            success: true,
            metier: metier.name,
            items: result.items,
            logs: [`🎯 Métier détecté : ${metier.name}`, ...result.logs],
            surface: result.surface,
            heures: result.heures
        };
    } catch (err) {
        return {
            success: false,
            error: `Erreur lors du calcul ${metier.name} : ${err.message}`
        };
    }
}

// ------------------------------------------------------------
// Découpe le texte en segments par métier détecté
// ------------------------------------------------------------
function segmenterParMetier(text) {
    const lower = text.toLowerCase();
    const segments = [];

    // Pour chaque métier, chercher la position de son premier mot-clé
    const positions = [];
    for (const metier of METIERS) {
        for (const kw of metier.keywords) {
            const idx = lower.indexOf(kw.toLowerCase());
            if (idx !== -1) {
                positions.push({
                    metier,
                    keyword: kw,
                    index: idx,
                    keywordLength: kw.length
                });
                break; // un seul mot-clé par métier suffit pour localiser
            }
        }
    }

    if (positions.length === 0) {
        return [];
    }

    // Trier par position dans le texte
    positions.sort((a, b) => a.index - b.index);

    // Construire les segments : chaque métier récupère le texte
    // depuis sa position jusqu'à la position du métier suivant
    for (let i = 0; i < positions.length; i++) {
        const current = positions[i];
        // Remonter un peu avant le mot-clé pour capter les dimensions
        // qui pourraient être avant ("salle de bain de 2.5x3 : carrelage")
        let start = Math.max(0, current.index - 60);

        // Chercher un séparateur naturel avant (virgule, point, "et", "+")
        const before = text.substring(start, current.index);
        const lastSep = Math.max(
            before.lastIndexOf(','),
            before.lastIndexOf('.'),
            before.lastIndexOf(';'),
            before.lastIndexOf(' et '),
            before.lastIndexOf(' + '),
            before.lastIndexOf(' puis ')
        );
        if (lastSep !== -1) {
            start = start + lastSep + 1;
        }

        // Fin = début du métier suivant, ou fin du texte
        let end = text.length;
        if (i + 1 < positions.length) {
            end = positions[i + 1].index;
            // Reculer un peu pour ne pas empiéter sur le métier suivant
            end = Math.max(current.index + current.keywordLength, end - 30);
        }

        const segment = text.substring(start, end).trim();

        segments.push({
            metier: current.metier,
            segment: segment || text // fallback : tout le texte si le segment est vide
        });
    }

    // Dédupliquer : si le même métier apparaît plusieurs fois, fusionner
    const merged = new Map();
    for (const seg of segments) {
        if (merged.has(seg.metier.name)) {
            merged.get(seg.metier.name).segment += ' ' + seg.segment;
        } else {
            merged.set(seg.metier.name, { ...seg });
        }
    }

    return Array.from(merged.values());
}

// ------------------------------------------------------------
// Calcule un devis multi-métiers
// ------------------------------------------------------------
// async function calculerDevisMultiMetiers(text, products, services) {
//     const segments = segmenterParMetier(text);

//     if (segments.length === 0) {
//         return {
//             success: false,
//             error: 'Aucun métier reconnu dans la description.'
//         };
//     }

//     const allItems = [];
//     const allLogs = [];
//     const metiersDetected = [];
//     let totalHeures = 0;

//     // Références utilisées pour éviter les doublons
//     const usedRefs = new Set();

//     for (const { metier, segment } of segments) {
//         allLogs.push(`\n━━━ ${metier.name.toUpperCase()} ━━━`);

//         try {
//             const result = await metier.compute(segment, products, services);

//             allLogs.push(...result.logs);

//             // Ajouter un suffixe au nom des items pour identifier le métier
//             for (const item of result.items) {
//                 // Éviter les collisions de références entre métiers
//                 let ref = item.ref;
//                 if (usedRefs.has(ref)) {
//                     ref = `${ref}-${metier.name.substring(0, 4).toUpperCase()}`;
//                 }
//                 usedRefs.add(ref);

//                 allItems.push({
//                     ...item,
//                     ref,
//                     // Préfixer le nom pour la lisibilité dans le devis
//                     name: `[${metier.name}] ${item.name}`
//                 });
//             }

//             metiersDetected.push(metier.name);
//             totalHeures += result.heures || 0;
//         } catch (err) {
//             allLogs.push(`❌ Erreur sur ${metier.name} : ${err.message}`);
//         }
//     }

//     if (allItems.length === 0) {
//         return {
//             success: false,
//             error: 'Aucun article calculé. Vérifiez les dimensions ou métiers décrits.'
//         };
//     }

//     const subtotal = allItems.reduce((sum, i) => sum + i.total, 0);

//     return {
//         success: true,
//         isMulti: true,
//         metiers: metiersDetected,
//         items: allItems,
//         logs: [
//             `🎯 ${metiersDetected.length} métier(s) détecté(s) : ${metiersDetected.join(', ')}`,
//             ...allLogs,
//             `\n━━━ TOTAL ━━━`,
//             `📦 ${allItems.length} ligne(s) générée(s)`,
//             `⏱️ Temps total cumulé : ${roundUp(totalHeures, 2)} h`,
//             `💰 Total HT : ${roundUp(subtotal, 2)} €`
//         ],
//         heures: roundUp(totalHeures, 2),
//         subtotal: roundUp(subtotal, 2)
//     };
// }
// async function calculerDevisMultiMetiers(text, products, services) {
//     const segments = segmenterParMetier(text);

//     if (segments.length === 0) {
//         return {
//             success: false,
//             error: 'Aucun métier reconnu dans la description.'
//         };
//     }

//     // 🔑 Extraire les dimensions GLOBALES de la phrase complète
//     const dimensionsGlobales = extractDimensions(text);
//     const dimensionsInjectees = dimensionsGlobales.length > 0
//         ? ` (${dimensionsGlobales.map(d => `${d.length}m x ${d.width}m`).join(', ')})`
//         : '';

//     if (dimensionsInjectees) {
//         // On prépare un log pour indiquer qu'on propage les dimensions
//         console.log(`📐 Dimensions globales détectées : ${dimensionsInjectees.trim()}`);
//     }

//     const allItems = [];
//     const allLogs = [];
//     const metiersDetected = [];
//     let totalHeures = 0;

//     // Références utilisées pour éviter les doublons
//     const usedRefs = new Set();

//     for (const { metier, segment } of segments) {
//         allLogs.push(`\n━━━ ${metier.name.toUpperCase()} ━━━`);

//         // 🎯 Si le segment ne contient PAS de dimensions, on injecte les dimensions globales
//         const segmentDimensions = extractDimensions(segment);
//         let segmentFinal = segment;
//         if (segmentDimensions.length === 0 && dimensionsGlobales.length > 0) {
//             segmentFinal = segment + dimensionsInjectees;
//             allLogs.push(`📐 Dimensions globales injectées dans ce segment`);
//         }

//         try {
//             const result = await metier.compute(segmentFinal, products, services);
//             allLogs.push(...result.logs);

//             // Ajouter un suffixe au nom des items pour identifier le métier
//             for (const item of result.items) {
//                 // Éviter les collisions de références entre métiers
//                 let ref = item.ref;
//                 if (usedRefs.has(ref)) {
//                     ref = `${ref}-${metier.name.substring(0, 4).toUpperCase()}`;
//                 }
//                 usedRefs.add(ref);

//                 allItems.push({
//                     ...item,
//                     ref,
//                     // Préfixer le nom pour la lisibilité dans le devis
//                     name: `[${metier.name}] ${item.name}`
//                 });
//             }

//             metiersDetected.push(metier.name);
//             totalHeures += result.heures || 0;
//         } catch (err) {
//             allLogs.push(`❌ Erreur sur ${metier.name} : ${err.message}`);
//         }
//     }

//     if (allItems.length === 0) {
//         return {
//             success: false,
//             error: 'Aucun article calculé. Vérifiez les dimensions ou métiers décrits.'
//         };
//     }

//     const subtotal = allItems.reduce((sum, i) => sum + i.total, 0);

//     return {
//         success: true,
//         isMulti: true,
//         metiers: metiersDetected,
//         items: allItems,
//         logs: [
//             `🎯 ${metiersDetected.length} métier(s) détecté(s) : ${metiersDetected.join(', ')}`,
//             ...allLogs,
//             `\n━━━ TOTAL ━━━`,
//             `📦 ${allItems.length} ligne(s) générée(s)`,
//             `⏱️ Temps total cumulé : ${roundUp(totalHeures, 2)} h`,
//             `💰 Total HT : ${roundUp(subtotal, 2)} €`
//         ],
//         heures: roundUp(totalHeures, 2),
//         subtotal: roundUp(subtotal, 2)
//     };
// }


async function calculerDevisMultiMetiers(text, products, services) {
    const segments = segmenterParMetier(text);

    if (segments.length === 0) {
        return {
            success: false,
            error: 'Aucun métier reconnu dans la description.'
        };
    }

    const allItems = [];
    const allLogs = [];
    const metiersDetected = [];
    let totalHeures = 0;
    const usedRefs = new Set();

    // 🔑 On NE injecte PLUS les dimensions globales dans chaque segment.
    // Chaque segment contient normalement déjà ses propres dimensions
    // (car segmenterParMetier rogne intelligemment autour du métier).
    // Si un segment n'a AUCUNE dimension ET qu'aucun autre segment n'en a,
    // on laisse le métier utiliser sa valeur par défaut.

    for (const { metier, segment } of segments) {
        allLogs.push(`\n━━━ ${metier.name.toUpperCase()} ━━━`);

        try {
            const result = await metier.compute(segment, products, services);
            allLogs.push(...result.logs);

            for (const item of result.items) {
                let ref = item.ref;
                if (usedRefs.has(ref)) {
                    ref = `${ref}-${metier.name.substring(0, 4).toUpperCase()}`;
                }
                usedRefs.add(ref);

                allItems.push({
                    ...item,
                    ref,
                    name: `[${metier.name}] ${item.name}`
                });
            }

            metiersDetected.push(metier.name);
            totalHeures += result.heures || 0;
        } catch (err) {
            allLogs.push(`❌ Erreur sur ${metier.name} : ${err.message}`);
        }
    }

    if (allItems.length === 0) {
        return {
            success: false,
            error: 'Aucun article calculé. Vérifiez les dimensions ou métiers décrits.'
        };
    }

    const subtotal = allItems.reduce((sum, i) => sum + i.total, 0);

    return {
        success: true,
        isMulti: true,
        metiers: metiersDetected,
        items: allItems,
        logs: [
            `🎯 ${metiersDetected.length} métier(s) détecté(s) : ${metiersDetected.join(', ')}`,
            ...allLogs,
            `\n━━━ TOTAL ━━━`,
            `📦 ${allItems.length} ligne(s) générée(s)`,
            `⏱️ Temps total cumulé : ${roundUp(totalHeures, 2)} h`,
            `💰 Total HT : ${roundUp(subtotal, 2)} €`
        ],
        heures: roundUp(totalHeures, 2),
        subtotal: roundUp(subtotal, 2)
    };
}
module.exports = {
    METIERS,
    detecterMetier,
    calculerDevisDepuisTexte,
    calculerDevisMultiMetiers,
    segmenterParMetier
};

