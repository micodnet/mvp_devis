// backend/__tests__/i18n.test.js
// Tests du système i18n

describe('i18n (back-end)', () => {
    const { t, formatDate, SUPPORTED_LANGUAGES } = require('../utils/i18n');

    test('Les 3 langues sont supportées', () => {
        expect(SUPPORTED_LANGUAGES).toContain('fr');
        expect(SUPPORTED_LANGUAGES).toContain('nl');
        expect(SUPPORTED_LANGUAGES).toContain('en');
    });

    test('Retourne la traduction FR pour quote.title', () => {
        expect(t('fr', 'quote.title')).toBe('DEVIS');
    });

    test('Retourne la traduction NL pour quote.title', () => {
        expect(t('nl', 'quote.title')).toBe('OFFERTE');
    });

    test('Retourne la traduction EN pour quote.title', () => {
        expect(t('en', 'quote.title')).toBe('QUOTE');
    });

    test('Fallback sur FR si langue inconnue', () => {
        expect(t('xx', 'quote.title')).toBe('DEVIS');
    });

    test('Retourne la clé si traduction introuvable', () => {
        expect(t('fr', 'cle.qui.nexiste.pas')).toBe('cle.qui.nexiste.pas');
    });

    test('formatDate FR : 19/09/2026', () => {
        expect(formatDate('fr', '2026-09-19')).toBe('19/09/2026');
    });

    test('formatDate gère les dates vides', () => {
        expect(formatDate('fr', null)).toBe('—');
    });
});