// // backend/utils/assistant/preferences.js
// // Gestion des préférences utilisateur pour l'assistant IA

// const { pool } = require('../../db');

// // Préférences par défaut si l'utilisateur n'en a pas encore
// const DEFAULT_PREFERENCES = {
//     hourlyRates: {},
//     defaultHourlyRate: 45.00,
//     defaultMarginPercent: 0.00,
//     defaultVatRegime: 'franchise',
//     defaultVatRate: 21.00,
//     defaultPaymentTerms: 30,
//     preferredSuppliers: {},
//     voiceCorrections: {},
//     misc: {}
// };

// // ------------------------------------------------------------
// // Charge les préférences d'un utilisateur (crée si inexistant)
// // ------------------------------------------------------------
// async function getUserPreferences(userId) {
//     try {
//         const result = await pool.query(
//             'SELECT * FROM assistant_preferences WHERE user_id = $1',
//             [userId]
//         );

//         if (result.rows.length === 0) {
//             // Créer une ligne avec les valeurs par défaut
//             await pool.query(
//                 'INSERT INTO assistant_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
//                 [userId]
//             );
//             return { ...DEFAULT_PREFERENCES };
//         }

//         const row = result.rows[0];
//         return {
//             hourlyRates: row.hourly_rates || {},
//             defaultHourlyRate: parseFloat(row.default_hourly_rate) || 45.00,
//             defaultMarginPercent: parseFloat(row.default_margin_percent) || 0,
//             defaultVatRegime: row.default_vat_regime || 'franchise',
//             defaultVatRate: parseFloat(row.default_vat_rate) || 21,
//             defaultPaymentTerms: parseInt(row.default_payment_terms) || 30,
//             preferredSuppliers: row.preferred_suppliers || {},
//             voiceCorrections: row.voice_corrections || {},
//             misc: row.misc || {}
//         };
//     } catch (err) {
//         console.error('Erreur getUserPreferences:', err);
//         return { ...DEFAULT_PREFERENCES };
//     }
// }

// // ------------------------------------------------------------
// // Met à jour un ou plusieurs champs de préférences
// // ------------------------------------------------------------
// async function updateUserPreferences(userId, updates) {
//     const allowedFields = {
//         hourlyRates: 'hourly_rates',
//         defaultHourlyRate: 'default_hourly_rate',
//         defaultMarginPercent: 'default_margin_percent',
//         defaultVatRegime: 'default_vat_regime',
//         defaultVatRate: 'default_vat_rate',
//         defaultPaymentTerms: 'default_payment_terms',
//         preferredSuppliers: 'preferred_suppliers',
//         voiceCorrections: 'voice_corrections',
//         misc: 'misc'
//     };

//     const fields = [];
//     const values = [];
//     let idx = 1;

//     for (const [key, val] of Object.entries(updates)) {
//         const col = allowedFields[key];
//         if (!col) continue;
//         fields.push(`${col} = $${idx}`);
//         // Sérialiser les objets JSON
//         values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
//         idx++;
//     }

//     if (fields.length === 0) return false;

//     values.push(userId);

//     try {
//         // S'assurer que la ligne existe
//         await pool.query(
//             'INSERT INTO assistant_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
//             [userId]
//         );

//         await pool.query(`
//             UPDATE assistant_preferences
//             SET ${fields.join(', ')}, updated_at = NOW()
//             WHERE user_id = $${idx}
//         `, values);

//         return true;
//     } catch (err) {
//         console.error('Erreur updateUserPreferences:', err);
//         return false;
//     }
// }

// // ------------------------------------------------------------
// // Récupère le taux horaire d'un métier (avec fallback)
// // ------------------------------------------------------------
// function getHourlyRateForMetier(prefs, metierName) {
//     if (!prefs || !metierName) return prefs?.defaultHourlyRate || 45;
//     const key = metierName.toLowerCase();
//     return prefs.hourlyRates[key] || prefs.defaultHourlyRate || 45;
// }

// // ------------------------------------------------------------
// // Applique une marge sur un prix
// // ------------------------------------------------------------
// function applyMargin(price, marginPercent) {
//     if (!marginPercent || marginPercent <= 0) return price;
//     return Math.round(price * (1 + marginPercent / 100) * 100) / 100;
// }

// // ------------------------------------------------------------
// // Ajoute une correction vocale au dictionnaire
// // ------------------------------------------------------------
// async function addVoiceCorrection(userId, wrong, correct) {
//     const prefs = await getUserPreferences(userId);
//     prefs.voiceCorrections[wrong.toLowerCase()] = correct;
//     return await updateUserPreferences(userId, { voiceCorrections: prefs.voiceCorrections });
// }

// // ------------------------------------------------------------
// // Applique les corrections vocales à un texte
// // ------------------------------------------------------------
// function applyVoiceCorrections(text, corrections) {
//     if (!text || !corrections || Object.keys(corrections).length === 0) return text;
//     let result = text;
//     for (const [wrong, correct] of Object.entries(corrections)) {
//         // Utiliser une regex insensible à la casse et avec limites de mots
//         const regex = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
//         result = result.replace(regex, correct);
//     }
//     return result;
// }

// module.exports = {
//     getUserPreferences,
//     updateUserPreferences,
//     getHourlyRateForMetier,
//     applyMargin,
//     addVoiceCorrection,
//     applyVoiceCorrections,
//     DEFAULT_PREFERENCES
// };


// backend/utils/assistant/preferences.js
// Gestion des préférences utilisateur pour l'assistant IA

const { pool } = require('../../db');

const DEFAULT_PREFERENCES = {
    hourlyRates: {},
    defaultHourlyRate: 45.00,
    defaultMarginPercent: 0.00,
    defaultVatRegime: 'franchise',
    defaultVatRate: 21.00,
    defaultPaymentTerms: 30,
    preferredSuppliers: {},
    voiceCorrections: {},
    misc: {}
};

async function getUserPreferences(userId) {
    try {
        const result = await pool.query(
            'SELECT * FROM assistant_preferences WHERE user_id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            await pool.query(
                'INSERT INTO assistant_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
                [userId]
            );
            return { ...DEFAULT_PREFERENCES };
        }

        const row = result.rows[0];
        return {
            hourlyRates: row.hourly_rates || {},
            defaultHourlyRate: parseFloat(row.default_hourly_rate) || 45.00,
            defaultMarginPercent: parseFloat(row.default_margin_percent) || 0,
            defaultVatRegime: row.default_vat_regime || 'franchise',
            defaultVatRate: parseFloat(row.default_vat_rate) || 21,
            defaultPaymentTerms: parseInt(row.default_payment_terms) || 30,
            preferredSuppliers: row.preferred_suppliers || {},
            voiceCorrections: row.voice_corrections || {},
            misc: row.misc || {}
        };
    } catch (err) {
        console.error('Erreur getUserPreferences:', err);
        return { ...DEFAULT_PREFERENCES };
    }
}

async function updateUserPreferences(userId, updates) {
    const allowedFields = {
        hourlyRates: 'hourly_rates',
        defaultHourlyRate: 'default_hourly_rate',
        defaultMarginPercent: 'default_margin_percent',
        defaultVatRegime: 'default_vat_regime',
        defaultVatRate: 'default_vat_rate',
        defaultPaymentTerms: 'default_payment_terms',
        preferredSuppliers: 'preferred_suppliers',
        voiceCorrections: 'voice_corrections',
        misc: 'misc'
    };

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
        const col = allowedFields[key];
        if (!col) continue;
        fields.push(`${col} = $${idx}`);
        values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
        idx++;
    }

    if (fields.length === 0) return false;

    values.push(userId);

    try {
        await pool.query(
            'INSERT INTO assistant_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [userId]
        );

        await pool.query(`
            UPDATE assistant_preferences
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE user_id = $${idx}
        `, values);

        return true;
    } catch (err) {
        console.error('Erreur updateUserPreferences:', err);
        return false;
    }
}

function getHourlyRateForMetier(prefs, metierName) {
    if (!prefs || !metierName) return prefs?.defaultHourlyRate || 45;
    const key = String(metierName).toLowerCase();
    return prefs.hourlyRates[key] || prefs.defaultHourlyRate || 45;
}

function applyMargin(price, marginPercent) {
    if (!marginPercent || marginPercent <= 0) return price;
    return Math.round(price * (1 + marginPercent / 100) * 100) / 100;
}

async function addVoiceCorrection(userId, wrong, correct) {
    const prefs = await getUserPreferences(userId);
    prefs.voiceCorrections[wrong.toLowerCase()] = correct;
    return await updateUserPreferences(userId, { voiceCorrections: prefs.voiceCorrections });
}

function applyVoiceCorrections(text, corrections) {
    if (!text || !corrections || Object.keys(corrections).length === 0) return text;
    let result = text;
    for (const [wrong, correct] of Object.entries(corrections)) {
        const regex = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        result = result.replace(regex, correct);
    }
    return result;
}

module.exports = {
    getUserPreferences,
    updateUserPreferences,
    getHourlyRateForMetier,
    applyMargin,
    addVoiceCorrection,
    applyVoiceCorrections,
    DEFAULT_PREFERENCES
};