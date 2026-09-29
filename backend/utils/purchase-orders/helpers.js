// backend/utils/purchase-orders/helpers.js
// Logique metier des bons de commande fournisseurs

const { pool } = require('../../db');

const STATUSES = {
    draft: { label: 'Brouillon', color: '#94a3b8' },
    sent: { label: 'Envoye', color: '#3b82f6' },
    partial: { label: 'Recu partiellement', color: '#eab308' },
    received: { label: 'Recu', color: '#22c55e' },
    cancelled: { label: 'Annule', color: '#f87171' }
};

// Genere un numero de bon de commande unique par utilisateur
async function generatePONumber(userId) {
    const year = new Date().getFullYear();
    const prefix = 'BC-' + year + '-';

    const result = await pool.query(`
        SELECT po_number FROM purchase_orders
        WHERE user_id = $1 AND po_number LIKE $2
        ORDER BY id DESC LIMIT 1
    `, [userId, prefix + '%']);

    let nextNumber = 1;
    if (result.rows.length > 0) {
        const match = result.rows[0].po_number.match(/-(\d+)$/);
        if (match) nextNumber = parseInt(match[1]) + 1;
    }

    return prefix + String(nextNumber).padStart(4, '0');
}

// Calcule les totaux d'un BC a partir de ses items
function computeTotals(items, vatRate = 21) {
    let subtotal = 0;
    const formatted = [];

    for (const item of items) {
        const quantity = parseFloat(item.quantity || item.qty) || 0;
        const unitPrice = parseFloat(item.unitPrice || item.unit_price) || 0;
        const total = Math.round(quantity * unitPrice * 100) / 100;

        subtotal += total;

        formatted.push({
            productId: item.productId || item.product_id || null,
            productRef: item.productRef || item.product_ref || null,
            productName: item.productName || item.product_name || item.name || 'Article',
            quantity: quantity,
            unit: item.unit || 'u',
            unitPrice: unitPrice,
            total: total
        });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    return { items: formatted, subtotal, vatAmount, total };
}

// Cree un BC en base de donnees
async function createPurchaseOrder(userId, data) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const poNumber = await generatePONumber(userId);

        // Charger le fournisseur si supplierId fourni
        let supplier = null;
        if (data.supplierId) {
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1 AND user_id = $2',
                [data.supplierId, userId]
            );
            if (supplierResult.rows.length > 0) {
                supplier = supplierResult.rows[0];
            }
        }

        // Recuperer le taux de TVA des settings
        const settingsResult = await client.query(
            'SELECT vat_rate FROM settings WHERE user_id = $1',
            [userId]
        );
        const vatRate = parseFloat(settingsResult.rows[0]?.vat_rate) || 21;

        const totals = computeTotals(data.items || [], vatRate);

        if (totals.items.length === 0) {
            throw new Error('Un bon de commande doit contenir au moins un article.');
        }

        // Inserer le BC
        const poResult = await client.query(`
            INSERT INTO purchase_orders (
                user_id, po_number, supplier_id, supplier_name, supplier_email,
                supplier_address, supplier_vat, order_date, expected_date,
                status, subtotal, vat_amount, total, notes,
                source, source_reference
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            userId,
            poNumber,
            data.supplierId || null,
            data.supplierName || (supplier ? supplier.name : null),
            data.supplierEmail || (supplier ? supplier.email : null),
            data.supplierAddress || (supplier ? supplier.address : null),
            data.supplierVat || (supplier ? supplier.vat_number : null),
            data.orderDate || new Date().toISOString().slice(0, 10),
            data.expectedDate || null,
            totals.subtotal,
            totals.vatAmount,
            totals.total,
            data.notes || null,
            data.source || 'manual',
            data.sourceReference || null
        ]);

        const poId = poResult.rows[0].id;

        // Inserer les items
        for (const item of totals.items) {
            await client.query(`
                INSERT INTO purchase_order_items (
                    purchase_order_id, product_id, product_ref, product_name,
                    quantity, unit, unit_price, total
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                poId,
                item.productId,
                item.productRef,
                item.productName,
                item.quantity,
                item.unit,
                item.unitPrice,
                item.total
            ]);
        }

        // Log
        await client.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'created', $3)
        `, [userId, poId, JSON.stringify({
            source: data.source || 'manual',
            sourceReference: data.sourceReference || null,
            itemsCount: totals.items.length,
            total: totals.total
        })]);

        await client.query('COMMIT');

        return poResult.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Detecte les produits sous le seuil d'alerte et prepare un BC par fournisseur
async function prepareFromLowStock(userId) {
    const lowStockResult = await pool.query(`
        SELECT p.*, s.id as supplier_id, s.name as supplier_name, s.email as supplier_email,
               s.address as supplier_address, s.vat_number as supplier_vat
        FROM products p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.user_id = $1
          AND p.track_stock = TRUE
          AND p.stock_quantity <= p.stock_alert_threshold
          AND p.supplier_id IS NOT NULL
          AND p.stock_alert_threshold > 0
    `, [userId]);

    if (lowStockResult.rows.length === 0) {
        return { created: 0, orders: [] };
    }

    // Regrouper par fournisseur
    const bySupplier = {};
    for (const p of lowStockResult.rows) {
        if (!bySupplier[p.supplier_id]) {
            bySupplier[p.supplier_id] = {
                supplierId: p.supplier_id,
                supplierName: p.supplier_name,
                supplierEmail: p.supplier_email,
                supplierAddress: p.supplier_address,
                supplierVat: p.supplier_vat,
                items: []
            };
        }

        // Calculer la quantite a commander : soit reorder_quantity, soit (seuil*2 - stock actuel)
        const stockQty = parseFloat(p.stock_quantity) || 0;
        const threshold = parseFloat(p.stock_alert_threshold) || 0;
        const reorderQty = parseFloat(p.reorder_quantity) || 0;
        const qtyToOrder = reorderQty > 0 ? reorderQty : Math.max(threshold * 2 - stockQty, 1);

        bySupplier[p.supplier_id].items.push({
            productId: p.id,
            productRef: p.ref,
            productName: p.name,
            quantity: qtyToOrder,
            unit: p.unit || 'u',
            unitPrice: parseFloat(p.unit_price) || 0
        });
    }

    const createdOrders = [];
    for (const supplierId of Object.keys(bySupplier)) {
        const s = bySupplier[supplierId];
        try {
            const po = await createPurchaseOrder(userId, {
                supplierId: s.supplierId,
                supplierName: s.supplierName,
                supplierEmail: s.supplierEmail,
                supplierAddress: s.supplierAddress,
                supplierVat: s.supplierVat,
                items: s.items,
                source: 'low_stock',
                sourceReference: 'Seuil d\'alerte atteint'
            });
            createdOrders.push({
                id: po.id,
                poNumber: po.po_number,
                supplierName: po.supplier_name,
                total: parseFloat(po.total)
            });
        } catch (err) {
            console.warn('Erreur creation BC low_stock pour fournisseur ' + supplierId + ':', err.message);
        }
    }

    return { created: createdOrders.length, orders: createdOrders };
}

// Prepare un BC pour les produits d'un devis signe qui sont en stock insuffisant
async function prepareFromQuote(userId, quoteId) {
    const quoteResult = await pool.query(
        'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
        [quoteId, userId]
    );

    if (quoteResult.rows.length === 0) {
        return { created: 0, orders: [], error: 'Devis introuvable' };
    }

    const quote = quoteResult.rows[0];
    const items = Array.isArray(quote.items) ? quote.items : [];

    if (items.length === 0) {
        return { created: 0, orders: [] };
    }

    // Pour chaque item, chercher le produit correspondant et verifier le stock
    const productsToOrder = [];

    for (const item of items) {
        if (!item.ref) continue;

        const productResult = await pool.query(`
            SELECT p.*, s.id as supplier_id, s.name as supplier_name, s.email as supplier_email,
                   s.address as supplier_address, s.vat_number as supplier_vat
            FROM products p
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.user_id = $1 AND p.ref = $2
            LIMIT 1
        `, [userId, item.ref]);

        if (productResult.rows.length === 0) continue;

        const product = productResult.rows[0];
        if (!product.supplier_id) continue;

        const stockQty = parseFloat(product.stock_quantity) || 0;
        const neededQty = parseFloat(item.qty) || 0;

        if (stockQty < neededQty) {
            const qtyToOrder = neededQty - stockQty;
            productsToOrder.push({
                supplierId: product.supplier_id,
                supplierName: product.supplier_name,
                supplierEmail: product.supplier_email,
                supplierAddress: product.supplier_address,
                supplierVat: product.supplier_vat,
                item: {
                    productId: product.id,
                    productRef: product.ref,
                    productName: product.name,
                    quantity: qtyToOrder,
                    unit: product.unit || 'u',
                    unitPrice: parseFloat(product.unit_price) || 0
                }
            });
        }
    }

    if (productsToOrder.length === 0) {
        return { created: 0, orders: [] };
    }

    // Regrouper par fournisseur
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

    const createdOrders = [];
    for (const supplierId of Object.keys(bySupplier)) {
        const s = bySupplier[supplierId];
        try {
            const po = await createPurchaseOrder(userId, {
                supplierId: s.supplierId,
                supplierName: s.supplierName,
                supplierEmail: s.supplierEmail,
                supplierAddress: s.supplierAddress,
                supplierVat: s.supplierVat,
                items: s.items,
                source: 'quote_signed',
                sourceReference: 'Devis ' + quote.quote_number
            });
            createdOrders.push({
                id: po.id,
                poNumber: po.po_number,
                supplierName: po.supplier_name,
                total: parseFloat(po.total)
            });
        } catch (err) {
            console.warn('Erreur creation BC quote_signed pour fournisseur ' + supplierId + ':', err.message);
        }
    }

    return { created: createdOrders.length, orders: createdOrders };
}

// Recoit (partiellement ou totalement) un BC et met a jour le stock
async function receivePurchaseOrder(userId, poId, receivedItems) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Charger le BC
        const poResult = await client.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [poId, userId]
        );

        if (poResult.rows.length === 0) {
            throw new Error('Bon de commande introuvable.');
        }

        const po = poResult.rows[0];

        // Charger les items du BC
        const itemsResult = await client.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [poId]
        );

        let allReceived = true;

        // Mettre a jour chaque item
        for (const item of itemsResult.rows) {
            const receivedQty = receivedItems && receivedItems[item.id] !== undefined
                ? parseFloat(receivedItems[item.id])
                : parseFloat(item.quantity);

            const newReceived = (parseFloat(item.quantity_received) || 0) + receivedQty;

            await client.query(`
                UPDATE purchase_order_items
                SET quantity_received = $1
                WHERE id = $2
            `, [newReceived, item.id]);

            // Mettre a jour le stock du produit associe
            if (item.product_id) {
                await client.query(`
                    UPDATE products
                    SET stock_quantity = stock_quantity + $1,
                        updated_at = NOW()
                    WHERE id = $2 AND user_id = $3
                `, [receivedQty, item.product_id, userId]);

                // Log du mouvement de stock
                await client.query(`
                    INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference)
                    VALUES ($1, $2, 'in', $3, 'Reception bon de commande', $4)
                `, [userId, item.product_id, receivedQty, po.po_number]);
            }

            if (newReceived < parseFloat(item.quantity)) {
                allReceived = false;
            }
        }

        // Mettre a jour le statut du BC
        const newStatus = allReceived ? 'received' : 'partial';
        const receivedDate = allReceived ? new Date().toISOString().slice(0, 10) : po.received_date;

        await client.query(`
            UPDATE purchase_orders
            SET status = $1,
                received_date = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [newStatus, receivedDate, poId]);

        // Log
        await client.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'received', $3)
        `, [userId, poId, JSON.stringify({
            status: newStatus,
            itemsCount: itemsResult.rows.length
        })]);

        await client.query('COMMIT');

        return { success: true, status: newStatus };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    STATUSES,
    generatePONumber,
    computeTotals,
    createPurchaseOrder,
    prepareFromLowStock,
    prepareFromQuote,
    receivePurchaseOrder
};