describe('Calculs de devis', () => {
    test('Calcule le total HT correctement', () => {
        const items = [
            { qty: 5, unitPrice: 12.50, total: 62.50 },
            { qty: 3, unitPrice: 8.90, total: 26.70 }
        ];
        const subtotal = items.reduce((s, i) => s + i.total, 0);
        expect(subtotal).toBe(89.20);
    });

    test('Calcule la TVA 21%', () => {
        const subtotal = 100;
        const vatRate = 21;
        const vatAmount = subtotal * (vatRate / 100);
        expect(vatAmount).toBe(21);
    });

    test('Franchise de TVA = 0', () => {
        const subtotal = 100;
        const vatRegime = 'franchise';
        const vatAmount = vatRegime === 'assujetti' ? subtotal * 0.21 : 0;
        expect(vatAmount).toBe(0);
    });
});