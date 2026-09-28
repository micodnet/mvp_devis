// backend/utils/purchase-orders/auto-prepare.js
// Preparation automatique de bons de commande apres signature d'un devis

const { pool } = require('../../db');

/**
 * Analyse un devis signe et prepare les bons de commande pour les produits
 * dont le stock est insuffisant.
 *
 * Regles :
 * - Pour chaque ligne du devis avec une reference produit correspondante en base
 * - Si le produit suit le stock (track_stock = true) et a un fournisseur (supplier_id)
 * - Si stock_quantity < quantite demandee -> creer un BC brouillon pour ce fournisseur
 * - Les produits d'un meme fournisseur sont regroupes dans un seul BC
 *
 * @param {number} userId - L'utilisateur proprietaire du devis
 * @param {number} quoteId - L'id du devis signe
 * @returns {Promise<Object>} - { created: number, orders: [...] }
 */
async function autoPrepareFromSignedQuote(userId, quoteId) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Charger le devis
        const quoteResult = await client.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, userId]
        );

        if (quoteResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { created: 0, orders: [], error: 'Devis introuvable' };
        }

        const quote = quoteResult.rows[0];
        const items = Array.isArray(quote.items) ? quote.items : [];

        if (items.length === 0) {
            await client.query('ROLLBACK');
            return { created: 0, orders: [] };
        }

        // 2. Pour chaque ligne du devis, verifier le stock
        const productsToOrder = [];

        for (const item of items) {
            if (!item.ref) continue;

            const productResult = await client.query(`
                SELECT p.*, s.id as supplier_id, s.name as supplier_name,
                       s.email as supplier_email, s.address as supplier_address,
                       s.vat_number as supplier_vat
                FROM products p
                LEFT JOIN suppliers s ON s.id = p.supplier_id
                WHERE p.user_id = $1 AND p.ref = $2
                LIMIT 1
            `, [userId, item.ref]);

            if (productResult.rows.length === 0) continue;

            const product = productResult.rows[0];

            if (!product.track_stock) continue;
            if (!product.supplier_id) continue;

            const stockQty = parseFloat(product.stock_quantity) || 0;
            const neededQty = parseFloat(item.qty) || 0;

            if (neededQty > stockQty) {
                const qtyToOrder = neededQty - stockQty;

                // Ajouter a la liste
                productsToOrder.push({
                    supplierId: product.supplier_id,
                    supplierName: product.supplier_name,
                    supplierEmail: product.supplier_email,
                    supplierAddress: product.supplier_address,
                    supplierVat: product.supplier_vat,
                    item: {
                        productId: product.id,
                        ref: product.ref,
                        name: product.name,
                        quantity: qtyToOrder,
                        unit: product.unit || 'u',
                        unitPrice: parseFloat(product.unit_price) || 0
                    }
                });
            }
        }

        if (productsToOrder.length === 0) {
            await client.query('ROLLBACK');
            return { created: 0, orders: [] };
        }

        // 3. Regrouper par fournisseur
        const bySupplier = {};
        for (const p of productsToOrder) {
            if (!bySupplier[p.supplierId]) {
                bySupplier[p.supplierId] = {
                    supplierId: p.supplierId,
                    supplierName: p.supplierName,
                    supplierEmail: p.supplierEmail,
                    supplierAddress: p.supplierAddress,
                    supplierVat: p.supplierVat,
                    items: []
                };
            }
            bySupplier[p.supplierId].items.push(p.item);
        }

        // 4. Creer un BC par fournisseur
        const createdOrders = [];

        for (const supplierId of Object.keys(bySupplier)) {
            const s = bySupplier[supplierId];

            try {
                // Numero de BC (basé sur le count pour eviter les collisions)
                const countResult = await client.query(
                    'SELECT COUNT(*) FROM purchase_orders WHERE user_id = $1',
                    [userId]
                );
                const nextNum = parseInt(countResult.rows[0].count) + 1;
                const poNumber = 'PO-' + String(nextNum).padStart(4, '0') + '-' + new Date().getFullYear();

                // Date de livraison souhaitee (dans 7 jours par defaut)
                const expectedDate = new Date();
                expectedDate.setDate(expectedDate.getDate() + 7);

                // Calculer les totaux (sans TVA pour un BC fournisseur, c'est le prix d'achat HT)
                let subtotal = 0;
                for (const item of s.items) {
                    subtotal += item.quantity * item.unitPrice;
                }

                // Creer la commande
                const poResult = await client.query(`
                    INSERT INTO purchase_orders (
                        user_id, po_number, supplier_id, supplier_name, status,
                        issue_date, expected_date, subtotal, total, notes,
                        source, source_reference
                    )
                    VALUES ($1, $2, $3, $4, 'draft', NOW(), $5, $6, $6, $7, 'quote_signed', $8)
                    RETURNING id, po_number
                `, [
                    userId,
                    poNumber,
                    s.supplierId,
                    s.supplierName,
                    expectedDate.toISOString().slice(0, 10),
                    subtotal,
                    'Prepare automatiquement apres signature du devis ' + quote.quote_number,
                    quote.quote_number
                ]);

                const poId = poResult.rows[0].id;

                // Inserer les lignes
                for (const item of s.items) {
                    const lineTotal = item.quantity * item.unitPrice;

                    await client.query(`
                        INSERT INTO purchase_order_items (
                            purchase_order_id, product_id, product_ref, product_name,
                            quantity, unit, unit_price, total
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [
                        poId,
                        item.productId,
                        item.ref,
                        item.name,
                        item.quantity,
                        item.unit,
                        item.unitPrice,
                        lineTotal
                    ]);
                }

                // Log
                await client.query(`
                    INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
                    VALUES ($1, $2, 'auto_created', $3)
                `, [userId, poId, JSON.stringify({
                    source: 'quote_signed',
                    quoteId: quote.id,
                    quoteNumber: quote.quote_number,
                    itemsCount: s.items.length,
                    total: subtotal
                })]);

                createdOrders.push({
                    id: poId,
                    poNumber: poResult.rows[0].po_number,
                    supplierName: s.supplierName,
                    itemsCount: s.items.length,
                    total: subtotal
                });
            } catch (err) {
                console.warn('Erreur creation BC auto pour fournisseur ' + supplierId + ':', err.message);
            }
        }

        await client.query('COMMIT');

        return {
            created: createdOrders.length,
            orders: createdOrders
        };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur autoPrepareFromSignedQuote:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { autoPrepareFromSignedQuote };