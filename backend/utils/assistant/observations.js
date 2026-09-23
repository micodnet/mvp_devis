// // backend/utils/assistant/observations.js
// // Système d'apprentissage automatique : observe les modifications et détecte des patterns

// const { pool } = require('../../db');

// // Nombre minimum d'occurrences avant de suggérer
// const MIN_OCCURRENCES = 3;

// // Fenêtre temporelle (en jours)
// const WINDOW_DAYS = 60;

// // ------------------------------------------------------------
// // Enregistre une observation (ou incrémente le compteur)
// // ------------------------------------------------------------
// async function recordObservation(userId, {
//     observationType,
//     context,
//     field,
//     oldValue,
//     newValue
// }) {
//     if (!observationType || !field || newValue === undefined || newValue === null) {
//         return null;
//     }

//     // Ne pas observer si la valeur n'a pas changé
//     if (oldValue !== undefined && oldValue !== null && Number(oldValue) === Number(newValue)) {
//         return null;
//     }

//     // Normaliser le context (lowercase, trim)
//     const ctx = context ? String(context).toLowerCase().trim().slice(0, 100) : null;

//     try {
//         // UPSERT : si une observation identique existe, incrémenter le compteur
//         const result = await pool.query(`
//             INSERT INTO assistant_observations 
//                 (user_id, observation_type, context, field, old_value, new_value, count, status, last_seen_at)
//             VALUES ($1, $2, $3, $4, $5, $6, 1, 'pending', NOW())
//             ON CONFLICT (user_id, observation_type, context, field, new_value)
//             DO UPDATE SET
//                 count = assistant_observations.count + 1,
//                 old_value = EXCLUDED.old_value,
//                 last_seen_at = NOW(),
//                 updated_at = NOW(),
//                 status = CASE 
//                     WHEN assistant_observations.status = 'dismissed' THEN 'dismissed'
//                     ELSE 'pending'
//                 END
//             RETURNING id, count, status
//         `, [userId, observationType, ctx, field, oldValue ?? null, newValue]);

//         const row = result.rows[0];
//         console.log(`📊 Observation enregistrée : ${observationType}/${ctx || 'global'}/${field} = ${newValue} (count: ${row.count})`);

//         return row;
//     } catch (err) {
//         console.error('Erreur recordObservation:', err.message);
//         return null;
//     }
// }

// // ------------------------------------------------------------
// // Détecte les patterns prêts à être suggérés (count >= MIN_OCCURRENCES)
// // ------------------------------------------------------------
// async function getPendingSuggestions(userId) {
//     try {
//         const result = await pool.query(`
//             SELECT * FROM assistant_observations
//             WHERE user_id = $1
//               AND status = 'pending'
//               AND count >= $2
//               AND last_seen_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
//             ORDER BY count DESC, last_seen_at DESC
//             LIMIT 5
//         `, [userId, MIN_OCCURRENCES]);

//         return result.rows.map(row => ({
//             id: row.id,
//             observationType: row.observation_type,
//             context: row.context,
//             field: row.field,
//             oldValue: row.old_value !== null ? parseFloat(row.old_value) : null,
//             newValue: parseFloat(row.new_value),
//             count: row.count,
//             lastSeenAt: row.last_seen_at
//         }));
//     } catch (err) {
//         console.error('Erreur getPendingSuggestions:', err.message);
//         return [];
//     }
// }

// // ------------------------------------------------------------
// // Marque une suggestion comme "affichée" (pour ne pas la répéter)
// // ------------------------------------------------------------
// async function markSuggestionAsSuggested(userId, observationId) {
//     await pool.query(`
//         UPDATE assistant_observations
//         SET status = 'suggested', updated_at = NOW()
//         WHERE id = $1 AND user_id = $2 AND status = 'pending'
//     `, [observationId, userId]);
// }

// // ------------------------------------------------------------
// // Accepte une suggestion : convertit l'observation en préférence
// // ------------------------------------------------------------
// async function acceptSuggestion(userId, observationId) {
//     const { updateUserPreferences } = require('./preferences');

//     const result = await pool.query(
//         'SELECT * FROM assistant_observations WHERE id = $1 AND user_id = $2',
//         [observationId, userId]
//     );

//     if (result.rows.length === 0) {
//         throw new Error('Observation introuvable.');
//     }

//     const obs = result.rows[0];

//     // Mapper le type d'observation vers une préférence
//     const prefUpdates = {};

//     switch (obs.observation_type) {
//         case 'hourly_rate': {
//             // Si contexte spécifique (métier), mettre dans hourlyRates
//             const { getUserPreferences } = require('./preferences');
//             const prefs = await getUserPreferences(userId);
//             if (obs.context) {
//                 prefs.hourlyRates[obs.context] = parseFloat(obs.new_value);
//                 prefUpdates.hourlyRates = prefs.hourlyRates;
//             } else {
//                 prefUpdates.defaultHourlyRate = parseFloat(obs.new_value);
//             }
//             break;
//         }
//         case 'margin': {
//             prefUpdates.defaultMarginPercent = parseFloat(obs.new_value);
//             break;
//         }
//         case 'vat_rate': {
//             prefUpdates.defaultVatRate = parseFloat(obs.new_value);
//             break;
//         }
//         case 'payment_terms': {
//             prefUpdates.defaultPaymentTerms = parseInt(obs.new_value);
//             break;
//         }
//         default:
//             throw new Error(`Type d'observation non supporté : ${obs.observation_type}`);
//     }

//     // Sauvegarder la préférence
//     const ok = await updateUserPreferences(userId, prefUpdates);
//     if (!ok) {
//         throw new Error('Impossible de sauvegarder la préférence.');
//     }

//     // Marquer l'observation comme acceptée
//     await pool.query(`
//         UPDATE assistant_observations
//         SET status = 'accepted', updated_at = NOW()
//         WHERE id = $1 AND user_id = $2
//     `, [observationId, userId]);

//     return {
//         observationType: obs.observation_type,
//         context: obs.context,
//         value: parseFloat(obs.new_value)
//     };
// }

// // ------------------------------------------------------------
// // Refuse une suggestion (ne plus jamais la proposer)
// // ------------------------------------------------------------
// async function dismissSuggestion(userId, observationId) {
//     await pool.query(`
//         UPDATE assistant_observations
//         SET status = 'dismissed', updated_at = NOW()
//         WHERE id = $1 AND user_id = $2
//     `, [observationId, userId]);
// }

// // ------------------------------------------------------------
// // Analyse les changements entre 2 versions d'un devis
// // ------------------------------------------------------------
// async function analyzeQuoteChanges(userId, oldQuote, newQuote) {
//     const observations = [];

//     // 1. Observer les changements de taux horaire sur la main d'œuvre
//     const oldItems = Array.isArray(oldQuote.items) ? oldQuote.items : [];
//     const newItems = Array.isArray(newQuote.items) ? newQuote.items : [];

//     // Pour chaque item MO- dans newItems, chercher l'équivalent dans oldItems
//     for (const newItem of newItems) {
//         if (!newItem.ref || !newItem.ref.startsWith('MO-')) continue;

//         // Chercher l'ancien
//         const oldItem = oldItems.find(o => o.ref === newItem.ref);

//         if (oldItem && Number(oldItem.unitPrice) !== Number(newItem.unitPrice)) {
//             // Le taux horaire a changé
//             // Extraire le métier depuis le nom : "[Peinture] Main d'œuvre..."
//             const metierMatch = (newItem.name || '').match(/\[([^\]]+)\]/);
//             const metier = metierMatch ? metierMatch[1].toLowerCase() : null;

//             observations.push({
//                 observationType: 'hourly_rate',
//                 context: metier,
//                 field: 'unitPrice',
//                 oldValue: Number(oldItem.unitPrice),
//                 newValue: Number(newItem.unitPrice)
//             });
//         }
//     }

//     // 2. Observer les changements de prix sur les produits (hors MO)
//     for (const newItem of newItems) {
//         if (newItem.ref && newItem.ref.startsWith('MO-')) continue;
//         if (!newItem.ref) continue;

//         const oldItem = oldItems.find(o => o.ref === newItem.ref);

//         if (oldItem && Number(oldItem.unitPrice) !== Number(newItem.unitPrice)) {
//             // Le prix produit a changé, calculer la marge implicite
//             const oldPrice = Number(oldItem.unitPrice);
//             const newPrice = Number(newItem.unitPrice);

//             if (oldPrice > 0 && newPrice > oldPrice) {
//                 const marginPercent = Math.round(((newPrice - oldPrice) / oldPrice) * 100);
//                 if (marginPercent >= 5 && marginPercent <= 200) {
//                     observations.push({
//                         observationType: 'margin',
//                         context: null,
//                         field: 'marginPercent',
//                         oldValue: 0,
//                         newValue: marginPercent
//                     });
//                 }
//             }
//         }
//     }

//     // 3. Observer les changements de régime TVA
//     if (oldQuote.vatRegime && newQuote.vatRegime && oldQuote.vatRegime !== newQuote.vatRegime) {
//         observations.push({
//             observationType: 'vat_rate',
//             context: null,
//             field: 'vatRate',
//             oldValue: null,
//             newValue: newQuote.vatRegime === 'assujetti' ? 21 : 0
//         });
//     }

//     // 4. Enregistrer toutes les observations détectées
//     const recorded = [];
//     for (const obs of observations) {
//         const result = await recordObservation(userId, obs);
//         if (result) recorded.push(result);
//     }

//     return recorded;
// }

// module.exports = {
//     recordObservation,
//     getPendingSuggestions,
//     markSuggestionAsSuggested,
//     acceptSuggestion,
//     dismissSuggestion,
//     analyzeQuoteChanges,
//     MIN_OCCURRENCES
// };


// backend/utils/assistant/observations.js
// Système d'apprentissage automatique : observe les modifications et détecte des patterns

const { pool } = require('../../db');

const MIN_OCCURRENCES = 3;
const WINDOW_DAYS = 60;

async function recordObservation(userId, {
    observationType,
    context,
    field,
    oldValue,
    newValue
}) {
    if (!observationType || !field || newValue === undefined || newValue === null) {
        return null;
    }

    if (oldValue !== undefined && oldValue !== null && Number(oldValue) === Number(newValue)) {
        return null;
    }

    const ctx = context ? String(context).toLowerCase().trim().slice(0, 100) : 'global';

    try {
        const result = await pool.query(`
            INSERT INTO assistant_observations 
                (user_id, observation_type, context, field, old_value, new_value, count, status, last_seen_at)
            VALUES ($1, $2, $3, $4, $5, $6, 1, 'pending', NOW())
            ON CONFLICT (user_id, observation_type, context, field, new_value)
            DO UPDATE SET
                count = assistant_observations.count + 1,
                old_value = EXCLUDED.old_value,
                last_seen_at = NOW(),
                updated_at = NOW(),
                status = CASE 
                    WHEN assistant_observations.status = 'dismissed' THEN 'dismissed'
                    ELSE 'pending'
                END
            RETURNING id, count, status
        `, [userId, observationType, ctx, field, oldValue ?? null, newValue]);

        const row = result.rows[0];
        console.log(`📊 Observation : ${observationType}/${ctx || 'global'}/${field} = ${newValue} (count: ${row.count})`);
        return row;
    } catch (err) {
        console.error('Erreur recordObservation:', err.message);
        return null;
    }
}

async function getPendingSuggestions(userId) {
    try {
        const result = await pool.query(`
            SELECT * FROM assistant_observations
            WHERE user_id = $1
              AND status = 'pending'
              AND count >= $2
              AND last_seen_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
            ORDER BY count DESC, last_seen_at DESC
            LIMIT 5
        `, [userId, MIN_OCCURRENCES]);

        return result.rows.map(row => ({
            id: row.id,
            observationType: row.observation_type,
            context: row.context,
            field: row.field,
            oldValue: row.old_value !== null ? parseFloat(row.old_value) : null,
            newValue: parseFloat(row.new_value),
            count: row.count,
            lastSeenAt: row.last_seen_at
        }));
    } catch (err) {
        console.error('Erreur getPendingSuggestions:', err.message);
        return [];
    }
}

async function markSuggestionAsSuggested(userId, observationId) {
    await pool.query(`
        UPDATE assistant_observations
        SET status = 'suggested', updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
    `, [observationId, userId]);
}

async function acceptSuggestion(userId, observationId) {
    const { updateUserPreferences, getUserPreferences } = require('./preferences');

    const result = await pool.query(
        'SELECT * FROM assistant_observations WHERE id = $1 AND user_id = $2',
        [observationId, userId]
    );

    if (result.rows.length === 0) {
        throw new Error('Observation introuvable.');
    }

    const obs = result.rows[0];
    const prefUpdates = {};

    switch (obs.observation_type) {
        case 'hourly_rate': {
            const prefs = await getUserPreferences(userId);
            if (obs.context) {
                prefs.hourlyRates[obs.context] = parseFloat(obs.new_value);
                prefUpdates.hourlyRates = prefs.hourlyRates;
            } else {
                prefUpdates.defaultHourlyRate = parseFloat(obs.new_value);
            }
            break;
        }
        case 'margin':
            prefUpdates.defaultMarginPercent = parseFloat(obs.new_value);
            break;
        case 'vat_rate':
            prefUpdates.defaultVatRate = parseFloat(obs.new_value);
            break;
        case 'payment_terms':
            prefUpdates.defaultPaymentTerms = parseInt(obs.new_value);
            break;
        default:
            throw new Error(`Type d'observation non supporté : ${obs.observation_type}`);
    }

    const ok = await updateUserPreferences(userId, prefUpdates);
    if (!ok) throw new Error('Impossible de sauvegarder la préférence.');

    await pool.query(`
        UPDATE assistant_observations
        SET status = 'accepted', updated_at = NOW()
        WHERE id = $1 AND user_id = $2
    `, [observationId, userId]);

    return {
        observationType: obs.observation_type,
        context: obs.context,
        value: parseFloat(obs.new_value)
    };
}

async function dismissSuggestion(userId, observationId) {
    await pool.query(`
        UPDATE assistant_observations
        SET status = 'dismissed', updated_at = NOW()
        WHERE id = $1 AND user_id = $2
    `, [observationId, userId]);
}

async function analyzeQuoteChanges(userId, oldQuote, newQuote) {
    const observations = [];

    const oldItems = Array.isArray(oldQuote.items) ? oldQuote.items : [];
    const newItems = Array.isArray(newQuote.items) ? newQuote.items : [];

    // 1. Taux horaire main d'œuvre
    for (const newItem of newItems) {
        if (!newItem.ref || !newItem.ref.startsWith('MO-')) continue;
        const oldItem = oldItems.find(o => o.ref === newItem.ref);
        if (oldItem && Number(oldItem.unitPrice) !== Number(newItem.unitPrice)) {
            const metierMatch = (newItem.name || '').match(/\[([^\]]+)\]/);
            const metier = metierMatch ? metierMatch[1].toLowerCase() : null;
            observations.push({
                observationType: 'hourly_rate',
                context: metier,
                field: 'unitPrice',
                oldValue: Number(oldItem.unitPrice),
                newValue: Number(newItem.unitPrice)
            });
        }
    }

    // 2. Marge sur produits
    for (const newItem of newItems) {
        if (newItem.ref && newItem.ref.startsWith('MO-')) continue;
        if (!newItem.ref) continue;
        const oldItem = oldItems.find(o => o.ref === newItem.ref);
        if (oldItem && Number(oldItem.unitPrice) !== Number(newItem.unitPrice)) {
            const oldPrice = Number(oldItem.unitPrice);
            const newPrice = Number(newItem.unitPrice);
            if (oldPrice > 0 && newPrice > oldPrice) {
                const marginPercent = Math.round(((newPrice - oldPrice) / oldPrice) * 100);
                if (marginPercent >= 5 && marginPercent <= 200) {
                    observations.push({
                        observationType: 'margin',
                        context: null,
                        field: 'marginPercent',
                        oldValue: 0,
                        newValue: marginPercent
                    });
                }
            }
        }
    }

    // 3. Régime TVA
    if (oldQuote.vat_regime && newQuote.vat_regime && oldQuote.vat_regime !== newQuote.vat_regime) {
        observations.push({
            observationType: 'vat_rate',
            context: null,
            field: 'vatRate',
            oldValue: null,
            newValue: newQuote.vat_regime === 'assujetti' ? 21 : 0
        });
    }

    const recorded = [];
    for (const obs of observations) {
        const result = await recordObservation(userId, obs);
        if (result) recorded.push(result);
    }

    return recorded;
}

module.exports = {
    recordObservation,
    getPendingSuggestions,
    markSuggestionAsSuggested,
    acceptSuggestion,
    dismissSuggestion,
    analyzeQuoteChanges,
    MIN_OCCURRENCES
};