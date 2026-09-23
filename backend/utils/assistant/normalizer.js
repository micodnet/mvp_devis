// backend/utils/assistant/normalizer.js
// Normalise les messages avant routage : nombres, langue, corrections vocales

// ------------------------------------------------------------
// Conversion des nombres écrits en chiffres
// ------------------------------------------------------------
const NUMBER_WORDS_FR = {
    'zero': 0, 'zéro': 0,
    'un': 1, 'une': 1,
    'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15,
    'seize': 16, 'vingt': 20, 'trente': 30, 'quarante': 40,
    'cinquante': 50, 'soixante': 60, 'cent': 100, 'mille': 1000
};

const NUMBER_WORDS_EN = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'twenty': 20, 'thirty': 30, 'forty': 40,
    'fifty': 50, 'sixty': 60, 'hundred': 100, 'thousand': 1000
};

const NUMBER_WORDS_NL = {
    'nul': 0, 'een': 1, 'twee': 2, 'drie': 3, 'vier': 4, 'vijf': 5,
    'zes': 6, 'zeven': 7, 'acht': 8, 'negen': 9, 'tien': 10,
    'elf': 11, 'twaalf': 12, 'dertien': 13, 'veertien': 14, 'vijftien': 15,
    'twintig': 20, 'dertig': 30, 'veertig': 40, 'vijftig': 50, 'zestig': 60,
    'honderd': 100, 'duizend': 1000
};

const ALL_NUMBERS = { ...NUMBER_WORDS_FR, ...NUMBER_WORDS_EN, ...NUMBER_WORDS_NL };

const QUANTITY_PATTERNS = {
    'une dizaine': 10, 'une douzaine': 12,
    'une vingtaine': 20, 'une trentaine': 30,
    'une cinquantaine': 50, 'une centaine': 100,
    'a dozen': 12, 'a few': 3,
    'een tiental': 10, 'een dozijn': 12
};

// ------------------------------------------------------------
// Convertit les nombres écrits en chiffres
// ------------------------------------------------------------
function convertNumbersToDigits(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;

    // 1. "une dizaine", "une douzaine", etc.
    for (const [phrase, num] of Object.entries(QUANTITY_PATTERNS)) {
        const regex = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'gi');
        result = result.replace(regex, String(num));
    }

    // 2. Nombres composés : "vingt-cinq" → "25", "trente-deux" → "32"
    const composedRegex = /\b(vingt|trente|quarante|cinquante|soixante|soixante-dix|quatre-vingt|quatre-vingt-dix)[\s-]+(un|deux|trois|quatre|cinq|six|sept|huit|neuf)\b/gi;
    result = result.replace(composedRegex, (match, tens, unit) => {
        const tensVal = ALL_NUMBERS[tens.toLowerCase()] || 0;
        const unitVal = ALL_NUMBERS[unit.toLowerCase()] || 0;
        return String(tensVal + unitVal);
    });

    // 3. Nombres simples : "trois murs" → "3 murs"
    // Regex : on capture un nombre écrit suivi d'un mot courant d'unité
    const simpleRegex = /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|mille|one|two|three|four|five|ten|twee|drie|vier|vijf|tien)\b/gi;
    result = result.replace(simpleRegex, (match) => {
        const key = match.toLowerCase();
        if (ALL_NUMBERS[key] !== undefined) {
            return String(ALL_NUMBERS[key]);
        }
        return match;
    });

    return result;
}

// ------------------------------------------------------------
// Détecte la langue d'un message (heuristique simple)
// ------------------------------------------------------------
function detectLanguage(text) {
    if (!text) return 'fr';
    const lower = text.toLowerCase();

    const frWords = /\b(le|la|les|un|une|des|je|tu|il|elle|nous|vous|ils|elles|de|du|pour|avec|dans|sur|au|aux|est|sont|fait|fais|crée|créer|ajoute|modifie|supprime|envoie|devis|client|facture|bonjour|merci)\b/g;
    const nlWords = /\b(de|het|een|ik|jij|hij|zij|wij|jullie|van|voor|met|in|op|is|zijn|maak|maken|voeg|toe|wijzig|verwijder|stuur|offerte|klant|factuur|hallo|bedankt)\b/g;
    const enWords = /\b(the|a|an|i|you|he|she|we|they|of|for|with|in|on|is|are|make|create|add|modify|delete|send|quote|client|invoice|hello|thanks)\b/g;

    const frCount = (lower.match(frWords) || []).length;
    const nlCount = (lower.match(nlWords) || []).length;
    const enCount = (lower.match(enWords) || []).length;

    const max = Math.max(frCount, nlCount, enCount);
    if (max === 0) return 'fr';
    if (frCount === max) return 'fr';
    if (nlCount === max) return 'nl';
    return 'en';
}

// ------------------------------------------------------------
// Applique les corrections vocales utilisateur
// ------------------------------------------------------------
function applyVoiceCorrections(text, corrections) {
    if (!text || !corrections || Object.keys(corrections).length === 0) return text;
    let result = text;
    for (const [wrong, correct] of Object.entries(corrections)) {
        const regex = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        result = result.replace(regex, correct);
    }
    return result;
}

// ------------------------------------------------------------
// Détecte les dates dans un texte et les normalise
// ------------------------------------------------------------
function extractAndNormalizeDates(text) {
    if (!text || typeof text !== 'string') return { text, dates: [] };

    const dates = [];
    let result = text;

    // Format FR : 31/12/2026 ou 31-12-2026
    const frDateRegex = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g;
    result = result.replace(frDateRegex, (match, d, m, y) => {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        dates.push(iso);
        return `${match} [${iso}]`;
    });

    return { text: result, dates };
}

// ------------------------------------------------------------
// Point d'entrée : normalise un message complet
// ------------------------------------------------------------
function normalizeMessage(text, userPrefs = null) {
    if (!text || typeof text !== 'string') {
        return { text: '', lang: 'fr', dates: [] };
    }

    let result = text.trim();

    // 1. Appliquer les corrections vocales si présentes
    if (userPrefs && userPrefs.voiceCorrections) {
        result = applyVoiceCorrections(result, userPrefs.voiceCorrections);
    }

    // 2. Convertir les nombres écrits en chiffres
    result = convertNumbersToDigits(result);

    // 3. Extraire les dates
    const { text: textWithoutDates, dates } = extractAndNormalizeDates(result);
    result = textWithoutDates;

    // 4. Détecter la langue
    const lang = detectLanguage(result);

    return { text: result, lang, dates };
}

module.exports = {
    normalizeMessage,
    convertNumbersToDigits,
    detectLanguage,
    applyVoiceCorrections,
    extractAndNormalizeDates
};