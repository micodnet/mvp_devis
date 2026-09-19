// Système de traduction ultra-léger (FR / NL / EN)
const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['fr', 'nl', 'en'];
const DEFAULT_LANGUAGE = 'fr';

const translations = {};

// Chargement des traductions au démarrage
SUPPORTED_LANGUAGES.forEach(lang => {
    const filePath = path.join(__dirname, '..', 'locales', `${lang}.json`);
    if (fs.existsSync(filePath)) {
        translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
        console.warn(`⚠️ Traductions manquantes pour : ${lang}`);
        translations[lang] = {};
    }
});

/**
 * Récupère une traduction par clé pointée (ex: "quote.title")
 */
function t(lang, key) {
    const language = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
    const dict = translations[language] || translations[DEFAULT_LANGUAGE];

    const parts = key.split('.');
    let value = dict;
    for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
            value = value[part];
        } else {
            // Fallback sur la langue par défaut
            value = translations[DEFAULT_LANGUAGE];
            for (const p of parts) {
                if (value && typeof value === 'object' && p in value) value = value[p];
                else return key;
            }
            return value;
        }
    }
    return value;
}

/**
 * Formate une date au format local (JJ/MM/AAAA pour FR et NL, MM/DD/YYYY pour EN)
 */
function formatDate(lang, d) {
    if (!d) return '—';
    try {
        const date = (d instanceof Date) ? d : new Date(d);
        if (isNaN(date.getTime())) return String(d);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (e) {
        return String(d);
    }
}

module.exports = { t, formatDate, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };