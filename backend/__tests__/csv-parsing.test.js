// backend/__tests__/csv-parsing.test.js
// Tests du parsing CSV et détection de colonnes

describe('Détection des colonnes CSV', () => {
    // Reproduction de la logique de detectColumn (dans routes/products.js)
    function normalizeHeader(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }

    function findColumn(headers, ...keys) {
        const normalizedHeaders = headers.map(h => normalizeHeader(h));
        for (const key of keys) {
            const keyNorm = normalizeHeader(key);
            if (!keyNorm) continue;
            const idx = normalizedHeaders.findIndex(h => h === keyNorm);
            if (idx !== -1) return idx;
        }
        for (const key of keys) {
            const keyNorm = normalizeHeader(key);
            if (!keyNorm) continue;
            const idx = normalizedHeaders.findIndex(h => h.includes(keyNorm));
            if (idx !== -1) return idx;
        }
        return -1;
    }

    test('Détecte "Nom"', () => {
        const headers = ['Nom', 'Prix', 'Référence'];
        expect(findColumn(headers, 'name', 'nom', 'designation')).toBe(0);
    });

    test('Détecte "Désignation" avec accent', () => {
        const headers = ['Désignation', 'Prix unitaire'];
        expect(findColumn(headers, 'name', 'designation')).toBe(0);
    });

    test('Détecte "Designation" sans accent (normalisation)', () => {
        const headers = ['Designation', 'Price'];
        expect(findColumn(headers, 'designation')).toBe(0);
    });

    test('Détecte "Référence" avec accent', () => {
        const headers = ['Nom', 'Référence'];
        expect(findColumn(headers, 'ref', 'reference', 'sku')).toBe(1);
    });

    test('Détecte "Price" en anglais', () => {
        const headers = ['Name', 'Price'];
        expect(findColumn(headers, 'prix', 'price')).toBe(1);
    });

    test('Détecte "P.U. HT" avec points', () => {
        const headers = ['Article', 'P.U. HT'];
        expect(findColumn(headers, 'pu', 'prix')).toBe(1);
    });

    test('Retourne -1 si aucune colonne trouvée', () => {
        const headers = ['Colonne1', 'Colonne2'];
        expect(findColumn(headers, 'name', 'prix')).toBe(-1);
    });

    test('Priorité au match exact avant match partiel', () => {
        const headers = ['Prix de vente', 'Prix'];
        expect(findColumn(headers, 'prix')).toBe(1); // "Prix" exact avant "Prix de vente"
    });
});