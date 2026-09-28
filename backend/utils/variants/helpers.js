// backend/utils/variants/helpers.js
// Logique metier des variantes de devis

// ------------------------------------------------------------
// Recalcule les totaux d'une variante a partir de ses items
// ------------------------------------------------------------
function computeVariantTotals(variant, vatRegime, vatRate) {
    let subtotal = 0;
    const formattedItems = [];

    for (const item of (variant.items || [])) {
        const qty = parseFloat(item.qty) || 1;
        const unitPrice = parseFloat(item.unitPrice) || 0;
        const total = Math.round(qty * unitPrice * 100) / 100;

        subtotal += total;
        formattedItems.push({
            ref: item.ref || 'EXT',
            name: item.name || 'Article',
            qty,
            unitPrice,
            total
        });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const vatAmount = vatRegime === 'assujetti'
        ? Math.round(subtotal * (vatRate / 100) * 100) / 100
        : 0;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    return {
        ...variant,
        items: formattedItems,
        subtotal,
        vatAmount,
        total
    };
}

// ------------------------------------------------------------
// Recalcule toutes les variantes d'un devis
// ------------------------------------------------------------
function computeAllVariants(variants, vatRegime, vatRate) {
    if (!Array.isArray(variants)) return [];

    return variants.map(v => computeVariantTotals(v, vatRegime, vatRate));
}

// ------------------------------------------------------------
// Valide la structure des variantes
// ------------------------------------------------------------
function validateVariants(variants) {
    if (!Array.isArray(variants)) {
        return { valid: false, error: 'variants doit etre un tableau' };
    }

    if (variants.length > 0 && (variants.length < 2 || variants.length > 5)) {
        return { valid: false, error: 'Un devis multi-options doit avoir entre 2 et 5 variantes' };
    }

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v.name || !v.name.trim()) {
            return { valid: false, error: 'Chaque variante doit avoir un nom' };
        }
        if (!Array.isArray(v.items) || v.items.length === 0) {
            return { valid: false, error: 'La variante "' + v.name + '" doit avoir au moins un article' };
        }
    }

    return { valid: true };
}

// ------------------------------------------------------------
// Extrait la variante selectionnee
// ------------------------------------------------------------
function getSelectedVariant(quote) {
    if (!quote.is_multi_option) return null;
    if (quote.selected_variant_index === null || quote.selected_variant_index === undefined) return null;

    const variants = Array.isArray(quote.variants) ? quote.variants : [];
    return variants[quote.selected_variant_index] || null;
}

module.exports = {
    computeVariantTotals,
    computeAllVariants,
    validateVariants,
    getSelectedVariant
};