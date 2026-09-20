// backend/__tests__/quotes-calculation.test.js
// Tests des calculs de devis (totaux, TVA, franchise)

describe('Calculs de devis', () => {
    // Fonction utilitaire qu'on retrouve dans plusieurs routes
    function computeTotals(items, vatRegime, vatRate) {
        const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
        const vatAmount = vatRegime === 'assujetti' ? subtotal * ((parseFloat(vatRate) || 0) / 100) : 0;
        const total = subtotal + vatAmount;
        return { subtotal, vatAmount, total };
    }

    test('Calcule le sous-total HT correctement', () => {
        const items = [
            { qty: 5, unitPrice: 12.50, total: 62.50 },
            { qty: 3, unitPrice: 8.90, total: 26.70 }
        ];
        const { subtotal } = computeTotals(items, 'franchise', 21);
        expect(subtotal).toBeCloseTo(89.20, 2);
    });

    test('Applique la TVA 21% en régime assujetti', () => {
        const items = [{ qty: 1, unitPrice: 100, total: 100 }];
        const { vatAmount, total } = computeTotals(items, 'assujetti', 21);
        expect(vatAmount).toBeCloseTo(21, 2);
        expect(total).toBeCloseTo(121, 2);
    });

    test('Pas de TVA en régime franchise', () => {
        const items = [{ qty: 1, unitPrice: 100, total: 100 }];
        const { vatAmount, total } = computeTotals(items, 'franchise', 21);
        expect(vatAmount).toBe(0);
        expect(total).toBe(100);
    });

    test('Gère les items vides', () => {
        const { subtotal, vatAmount, total } = computeTotals([], 'assujetti', 21);
        expect(subtotal).toBe(0);
        expect(vatAmount).toBe(0);
        expect(total).toBe(0);
    });

    test('Gère les prix en string (comme depuis un formulaire)', () => {
        const items = [{ qty: 2, unitPrice: '25.50', total: '51.00' }];
        const { subtotal, total } = computeTotals(items, 'franchise', 21);
        expect(subtotal).toBe(51);
        expect(total).toBe(51);
    });

    test('Calcule correctement 100 devis avec TVA 21%', () => {
        const items = [{ qty: 100, unitPrice: 12.50, total: 1250 }];
        const { vatAmount, total } = computeTotals(items, 'assujetti', 21);
        expect(vatAmount).toBeCloseTo(262.50, 2);
        expect(total).toBeCloseTo(1512.50, 2);
    });
});