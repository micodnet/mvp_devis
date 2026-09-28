// backend/routes/stock.js
// Gestion du stock + commandes fournisseurs

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generatePurchaseOrderPDF } = require('../utils/pdf-generator-po');
const { sendPurchaseOrderEmail } = require('../utils/email/po-sender');

const router = express.Router();

// ============================================================
// GET /api/stock/movements — Historique des mouvements
// ============================================================
router.get('/movements', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 200;
        const productId = req.query.product_id ? parseInt(req.query.product_id) : null;

        let query = `
            SELECT sm.*, p.name as product_name, p.ref as product_ref
            FROM stock_movements sm
            LEFT JOIN products p ON p.id = sm.product_id
            WHERE sm.user_id = $1
        `;
        const params = [req.user.id];
        if (productId) {
            params.push(productId);
            query += ` AND sm.product_id = $${params.length}`;
        }
        query += ` ORDER BY sm.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await pool.query(query, params);
        res.json(result.rows.map(m => ({
            id: m.id,
            productId: m.product_id,
            productName: m.product_name,
            productRef: m.product_ref,
            movementType: m.movement_type,
            quantity: parseFloat(m.quantity),
            reason: m.reason,
            reference: m.reference,
            createdAt: m.created_at
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/stock/movements — Créer un mouvement manuel
// ============================================================
router.post('/movements', authenticateToken, async (req, res) => {
    const { productId, movementType, quantity, reason, reference } = req.body;

    if (!productId || !movementType || !quantity) {
        return res.status(400).json({ error: 'Product, type et quantité requis.' });
    }
    if (!['in', 'out', 'adjustment'].includes(movementType)) {
        return res.status(400).json({ error: 'Type de mouvement invalide.' });
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty === 0) return res.status(400).json({ error: 'Quantité invalide.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const prodResult = await client.query(
            'SELECT id, stock_quantity FROM products WHERE id = $1 AND user_id = $2',
            [productId, req.user.id]
        );
        if (prodResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Produit non trouvé.' });
        }
        const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;

        let newStock = currentStock;
        if (movementType === 'in') newStock = currentStock + qty;
        else if (movementType === 'out') newStock = currentStock - qty;
        else if (movementType === 'adjustment') newStock = qty;

        await client.query(`
            INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.user.id, productId, movementType, qty, reason || null, reference || null]);

        await client.query(
            'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
            [newStock, productId]
        );

        await client.query('COMMIT');

        res.json({ success: true, newStock, productId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// GET /api/stock/alerts — Produits sous le seuil d'alerte
// ============================================================
router.get('/alerts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, p.ref, p.name, p.unit, p.stock_quantity, p.stock_alert_threshold,
                   p.reorder_quantity, p.supplier_id,
                   s.name as supplier_name, s.email as supplier_email, s.delivery_days
            FROM products p
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.user_id = $1
              AND p.track_stock = TRUE
              AND p.stock_quantity <= p.stock_alert_threshold
            ORDER BY (p.stock_quantity - p.stock_alert_threshold) ASC
        `, [req.user.id]);

        res.json(result.rows.map(r => ({
            id: r.id,
            ref: r.ref,
            name: r.name,
            unit: r.unit,
            stockQuantity: parseFloat(r.stock_quantity) || 0,
            threshold: parseFloat(r.stock_alert_threshold) || 0,
            reorderQuantity: parseFloat(r.reorder_quantity) || 0,
            supplierId: r.supplier_id,
            supplierName: r.supplier_name,
            supplierEmail: r.supplier_email,
            deliveryDays: r.delivery_days
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/stock/sync-invoice/:invoiceId — Déduire le stock après facture
// ============================================================
router.post('/sync-invoice/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const invResult = await client.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (invResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Facture non trouvée.' });
        }
        const invoice = invResult.rows[0];

        const existing = await client.query(
            'SELECT id FROM stock_movements WHERE related_invoice_id = $1 AND movement_type = $2',
            [invoiceId, 'sale']
        );
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Stock déjà synchronisé pour cette facture.' });
        }

        const items = invoice.items || [];
        let movements = 0;

        for (const item of items) {
            if (!item.ref) continue;
            const prodResult = await client.query(
                'SELECT id, stock_quantity FROM products WHERE user_id = $1 AND ref = $2 AND track_stock = TRUE',
                [req.user.id, item.ref]
            );
            if (prodResult.rows.length === 0) continue;

            const product = prodResult.rows[0];
            const currentStock = parseFloat(product.stock_quantity) || 0;
            const qty = parseFloat(item.qty) || 0;
            const newStock = currentStock - qty;

            await client.query(`
                INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference, related_invoice_id)
                VALUES ($1, $2, 'sale', $3, $4, $5, $6)
            `, [req.user.id, product.id, qty, 'Facture ' + invoice.invoice_number, invoice.invoice_number, invoiceId]);

            await client.query(
                'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                [newStock, product.id]
            );

            movements++;
        }

        await client.query('COMMIT');

        res.json({ success: true, movements });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// POST /api/stock/generate-po — Génère des commandes fournisseurs auto
// ============================================================
router.post('/generate-po', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const alerts = await client.query(`
            SELECT p.id, p.ref, p.name, p.stock_quantity, p.stock_alert_threshold,
                   p.reorder_quantity, p.stock_max, p.supplier_id,
                   COALESCE(p.cost_price, p.unit_price, 0) as unit_price
            FROM products p
            WHERE p.user_id = $1
              AND p.track_stock = TRUE
              AND p.stock_quantity <= p.stock_alert_threshold
              AND p.supplier_id IS NOT NULL
        `, [req.user.id]);

        if (alerts.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: true, generated: 0, message: 'Aucun produit en alerte avec fournisseur.' });
        }

        const bySupplier = {};
        for (const row of alerts.rows) {
            if (!bySupplier[row.supplier_id]) bySupplier[row.supplier_id] = [];
            bySupplier[row.supplier_id].push(row);
        }

        const createdPOs = [];

        for (const [supplierId, products] of Object.entries(bySupplier)) {
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1',
                [supplierId]
            );
            if (supplierResult.rows.length === 0) continue;
            const supplier = supplierResult.rows[0];

            const counterResult = await client.query(`
                SELECT COUNT(*) FROM purchase_orders WHERE user_id = $1
            `, [req.user.id]);
            const nextNum = parseInt(counterResult.rows[0].count) + 1;
            const poNumber = `PO-${String(nextNum).padStart(4, '0')}-${new Date().getFullYear()}`;

            let subtotal = 0;
            const items = products.map(p => {
                const qty = parseFloat(p.reorder_quantity) > 0
                    ? parseFloat(p.reorder_quantity)
                    : Math.max(1, (parseFloat(p.stock_max) || 10) - (parseFloat(p.stock_quantity) || 0));
                const unitPrice = parseFloat(p.unit_price) || 0;
                const total = qty * unitPrice;
                subtotal += total;
                return {
                    productId: p.id,
                    ref: p.ref,
                    name: p.name,
                    quantity: qty,
                    unit: p.unit || 'u',
                    unitPrice,
                    total
                };
            });

            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() + (supplier.delivery_days || 7));

            const poResult = await client.query(`
                INSERT INTO purchase_orders (
                    user_id, po_number, supplier_id, supplier_name, status,
                    issue_date, expected_date, subtotal, total,
                    source, source_reference
                )
                VALUES ($1, $2, $3, $4, 'draft', NOW(), $5, $6, $6, 'low_stock', 'Seuil d''alerte atteint')
                RETURNING id, po_number
            `, [
                req.user.id, poNumber, supplierId, supplier.name,
                expectedDate.toISOString().slice(0, 10), subtotal
            ]);

            const poId = poResult.rows[0].id;

            for (const item of items) {
                await client.query(`
                    INSERT INTO purchase_order_items (purchase_order_id, product_id, product_ref, product_name, quantity, unit, unit_price, total)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [poId, item.productId, item.ref, item.name, item.quantity, item.unit, item.unitPrice, item.total]);
            }

            await client.query(`
                INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
                VALUES ($1, $2, 'auto_created', $3)
            `, [req.user.id, poId, JSON.stringify({
                source: 'low_stock',
                itemsCount: items.length,
                total: subtotal
            })]);

            createdPOs.push({
                id: poId,
                poNumber: poResult.rows[0].po_number,
                supplierName: supplier.name,
                items: items.length,
                total: subtotal
            });
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            generated: createdPOs.length,
            purchaseOrders: createdPOs
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// GET /api/stock/purchase-orders — Liste des commandes
// ============================================================
router.get('/purchase-orders', authenticateToken, async (req, res) => {
    try {
        const status = req.query.status;

        let query = `
            SELECT po.*,
                   (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as items_count
            FROM purchase_orders po
            WHERE po.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ' AND po.status = $' + params.length;
        }

        query += ' ORDER BY po.created_at DESC LIMIT 200';

        const result = await pool.query(query, params);

        res.json(result.rows.map(po => ({
            id: po.id,
            poNumber: po.po_number,
            supplierId: po.supplier_id,
            supplierName: po.supplier_name,
            status: po.status,
            issueDate: po.issue_date,
            expectedDate: po.expected_date,
            receivedDate: po.received_date,
            subtotal: parseFloat(po.subtotal) || 0,
            total: parseFloat(po.total) || 0,
            itemsCount: parseInt(po.items_count) || 0,
            notes: po.notes,
            source: po.source,
            sourceReference: po.source_reference,
            sentAt: po.sent_at,
            sentToEmail: po.sent_to_email,
            createdAt: po.created_at
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/stock/purchase-orders/:id — Détail avec lignes
// ============================================================
router.get('/purchase-orders/:id', authenticateToken, async (req, res) => {
    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (poResult.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvée.' });
        const po = poResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id ASC',
            [po.id]
        );

        res.json({
            id: po.id,
            poNumber: po.po_number,
            supplierId: po.supplier_id,
            supplierName: po.supplier_name,
            status: po.status,
            issueDate: po.issue_date,
            expectedDate: po.expected_date,
            receivedDate: po.received_date,
            subtotal: parseFloat(po.subtotal) || 0,
            total: parseFloat(po.total) || 0,
            notes: po.notes,
            source: po.source,
            sourceReference: po.source_reference,
            sentAt: po.sent_at,
            sentToEmail: po.sent_to_email,
            items: itemsResult.rows.map(i => ({
                id: i.id,
                productId: i.product_id,
                productRef: i.product_ref,
                productName: i.product_name,
                quantity: parseFloat(i.quantity),
                unit: i.unit || 'u',
                unitPrice: parseFloat(i.unit_price),
                total: parseFloat(i.total),
                quantityReceived: parseFloat(i.quantity_received) || 0
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/stock/purchase-orders — Creer un BC manuellement
// ============================================================
router.post('/purchase-orders', authenticateToken, async (req, res) => {
    const { supplierId, supplierEmail, items, issueDate, expectedDate, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Charger le fournisseur
        let supplier = null;
        if (supplierId) {
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1 AND user_id = $2',
                [supplierId, req.user.id]
            );
            if (supplierResult.rows.length > 0) supplier = supplierResult.rows[0];
        }

        // Numero de BC
        const counterResult = await client.query(
            'SELECT COUNT(*) FROM purchase_orders WHERE user_id = $1',
            [req.user.id]
        );
        const nextNum = parseInt(counterResult.rows[0].count) + 1;
        const poNumber = 'PO-' + String(nextNum).padStart(4, '0') + '-' + new Date().getFullYear();

        // Calculer les totaux
        let subtotal = 0;
        const formattedItems = [];
        for (const it of items) {
            const qty = parseFloat(it.quantity) || 0;
            const unitPrice = parseFloat(it.unitPrice) || 0;
            const total = Math.round(qty * unitPrice * 100) / 100;
            subtotal += total;

            formattedItems.push({
                productId: it.productId || null,
                ref: it.productRef || it.ref || null,
                name: it.productName || it.name || 'Article',
                quantity: qty,
                unit: it.unit || 'u',
                unitPrice,
                total
            });
        }
        subtotal = Math.round(subtotal * 100) / 100;

        // Creer le BC
        const poResult = await client.query(`
            INSERT INTO purchase_orders (
                user_id, po_number, supplier_id, supplier_name, status,
                issue_date, expected_date, subtotal, total, notes,
                source
            )
            VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $7, $8, 'manual')
            RETURNING *
        `, [
            req.user.id,
            poNumber,
            supplierId || null,
            supplier ? supplier.name : null,
            issueDate || new Date().toISOString().slice(0, 10),
            expectedDate || null,
            subtotal,
            notes || null
        ]);

        const poId = poResult.rows[0].id;

        // Inserer les lignes
        for (const item of formattedItems) {
            await client.query(`
                INSERT INTO purchase_order_items (
                    purchase_order_id, product_id, product_ref, product_name,
                    quantity, unit, unit_price, total
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [poId, item.productId, item.ref, item.name, item.quantity, item.unit, item.unitPrice, item.total]);
        }

        // Si un email a ete saisi, le stocker sur le BC (sans envoyer)
        if (supplierEmail) {
            await client.query(
                'UPDATE purchase_orders SET sent_to_email = $1 WHERE id = $2',
                [supplierEmail, poId]
            );
        }

        // Log
        await client.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'created', $3)
        `, [req.user.id, poId, JSON.stringify({ source: 'manual', itemsCount: formattedItems.length, total: subtotal })]);

        await client.query('COMMIT');

        res.json({ success: true, purchaseOrder: poResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// PUT /api/stock/purchase-orders/:id — Modifier un BC brouillon
// ============================================================
router.put('/purchase-orders/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { supplierId, supplierEmail, items, expectedDate, notes } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkResult = await client.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Commande non trouvée.' });
        }

        const po = checkResult.rows[0];

        if (po.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Seul un brouillon peut etre modifie.' });
        }

        // Charger le fournisseur si fourni
        let supplier = null;
        if (supplierId) {
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1 AND user_id = $2',
                [supplierId, req.user.id]
            );
            if (supplierResult.rows.length > 0) supplier = supplierResult.rows[0];
        }

        // Calculer les totaux
        let subtotal = 0;
        const formattedItems = [];
        if (Array.isArray(items)) {
            for (const it of items) {
                const qty = parseFloat(it.quantity) || 0;
                const unitPrice = parseFloat(it.unitPrice) || 0;
                const total = Math.round(qty * unitPrice * 100) / 100;
                subtotal += total;

                formattedItems.push({
                    productId: it.productId || null,
                    ref: it.productRef || it.ref || null,
                    name: it.productName || it.name || 'Article',
                    quantity: qty,
                    unit: it.unit || 'u',
                    unitPrice,
                    total
                });
            }
        }
        subtotal = Math.round(subtotal * 100) / 100;

        // Mettre a jour l'entete
        await client.query(`
            UPDATE purchase_orders SET
                supplier_id = $1,
                supplier_name = $2,
                sent_to_email = COALESCE($3, sent_to_email),
                expected_date = COALESCE($4, expected_date),
                subtotal = $5,
                total = $5,
                notes = COALESCE($6, notes),
                updated_at = NOW()
            WHERE id = $7 AND user_id = $8
        `, [
            supplierId || null,
            supplier ? supplier.name : po.supplier_name,
            supplierEmail || null,
            expectedDate || null,
            subtotal,
            notes !== undefined ? notes : null,
            id,
            req.user.id
        ]);

        // Remplacer les items
        if (formattedItems.length > 0) {
            await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id]);

            for (const item of formattedItems) {
                await client.query(`
                    INSERT INTO purchase_order_items (
                        purchase_order_id, product_id, product_ref, product_name,
                        quantity, unit, unit_price, total
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [id, item.productId, item.ref, item.name, item.quantity, item.unit, item.unitPrice, item.total]);
            }
        }

        // Log
        await client.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'updated', $3)
        `, [req.user.id, id, JSON.stringify({ itemsCount: formattedItems.length, total: subtotal })]);

        await client.query('COMMIT');

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// PUT /api/stock/purchase-orders/:id/status — Changer le statut
// ============================================================
router.put('/purchase-orders/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    if (!['draft', 'sent', 'received', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Statut invalide.' });
    }

    try {
        const result = await pool.query(`
            UPDATE purchase_orders
            SET status = $1,
                received_date = CASE WHEN $1 = 'received' THEN NOW() ELSE received_date END,
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
            RETURNING id, status
        `, [status, req.params.id, req.user.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvée.' });

        await pool.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'status_changed', $3)
        `, [req.user.id, parseInt(req.params.id), JSON.stringify({ newStatus: status })]);

        res.json({ success: true, status: result.rows[0].status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/stock/purchase-orders/:id/send-email — Envoyer par email
// ============================================================
router.post('/purchase-orders/:id/send-email', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { email } = req.body;

    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (poResult.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvée.' });

        const po = poResult.rows[0];

        // Charger les items + company + fournisseur
        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [id]
        );

        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const company = settingsResult.rows[0] || {};

        let supplier = {
            name: po.supplier_name,
            email: po.sent_to_email,
            address: null,
            vat: null
        };

        if (po.supplier_id) {
            const supResult = await pool.query(
                'SELECT * FROM suppliers WHERE id = $1',
                [po.supplier_id]
            );
            if (supResult.rows.length > 0) {
                const s = supResult.rows[0];
                supplier = {
                    name: s.name,
                    contactName: s.contact_name,
                    email: s.email,
                    phone: s.phone,
                    address: s.address,
                    vat: s.vat_number
                };
            }
        }

        const finalEmail = email || supplier.email;
        if (!finalEmail) {
            return res.status(400).json({ error: 'Aucun email fournisseur. Precisez-en un.' });
        }

        // Envoyer
        const result = await sendPurchaseOrderEmail(
            po,
            itemsResult.rows,
            company,
            supplier,
            finalEmail
        );

        // Mettre a jour le statut et la date d'envoi
        const newStatus = po.status === 'draft' ? 'sent' : po.status;

        await pool.query(`
            UPDATE purchase_orders
            SET status = $1, sent_at = NOW(), sent_to_email = $2, updated_at = NOW()
            WHERE id = $3 AND user_id = $4
        `, [newStatus, finalEmail, id, req.user.id]);

        await pool.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'sent_by_email', $3)
        `, [req.user.id, id, JSON.stringify({ email: finalEmail })]);

        res.json({ success: true, sentTo: finalEmail, messageId: result.messageId });
    } catch (err) {
        console.error('Erreur send purchase order:', err);

        // Log erreur
        try {
            await pool.query(`
                INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, error_message)
                VALUES ($1, $2, 'send_error', $3)
            `, [req.user.id, id, err.message]);
        } catch (logErr) {
            console.warn('Erreur log:', logErr.message);
        }

        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/stock/purchase-orders/:id/receive — Réceptionner
// ============================================================
router.post('/purchase-orders/:id/receive', authenticateToken, async (req, res) => {
    const { receivedItems } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const poResult = await client.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (poResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Commande non trouvée.' });
        }
        const po = poResult.rows[0];

        if (po.status === 'received') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Commande déjà réceptionnée.' });
        }

        const itemsResult = await client.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [po.id]
        );

        let allReceived = true;
        let totalReceived = 0;

        for (const item of itemsResult.rows) {
            if (!item.product_id) continue;

            // Quantite recue : soit surcharge fournie, soit totalite de la ligne
            let qtyToReceive = parseFloat(item.quantity);
            if (receivedItems && receivedItems[item.id] !== undefined) {
                qtyToReceive = parseFloat(receivedItems[item.id]) || 0;
            }

            const alreadyReceived = parseFloat(item.quantity_received) || 0;
            const newReceived = alreadyReceived + qtyToReceive;

            // Mettre a jour la ligne
            await client.query(
                'UPDATE purchase_order_items SET quantity_received = $1 WHERE id = $2',
                [newReceived, item.id]
            );

            // Mettre a jour le stock
            const prodResult = await client.query(
                'SELECT stock_quantity FROM products WHERE id = $1',
                [item.product_id]
            );
            if (prodResult.rows.length === 0) continue;

            const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;
            const newStock = currentStock + qtyToReceive;

            await client.query(
                'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                [newStock, item.product_id]
            );

            // Log mouvement
            await client.query(`
                INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference, related_purchase_order_id)
                VALUES ($1, $2, 'purchase', $3, $4, $5, $6)
            `, [req.user.id, item.product_id, qtyToReceive, 'Reception ' + po.po_number, po.po_number, po.id]);

            totalReceived += qtyToReceive;

            if (newReceived < parseFloat(item.quantity)) {
                allReceived = false;
            }
        }

        const newStatus = allReceived ? 'received' : 'partial';
        const receivedDate = allReceived ? new Date().toISOString().slice(0, 10) : null;

        await client.query(`
            UPDATE purchase_orders
            SET status = $1,
                received_date = COALESCE($2, received_date),
                updated_at = NOW()
            WHERE id = $3
        `, [newStatus, receivedDate, po.id]);

        await client.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action, details)
            VALUES ($1, $2, 'received', $3)
        `, [req.user.id, po.id, JSON.stringify({ status: newStatus, totalReceived })]);

        await client.query('COMMIT');

        res.json({ success: true, status: newStatus, items: itemsResult.rows.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
});

// ============================================================
// GET /api/stock/purchase-orders/:id/pdf — PDF de la commande
// ============================================================
router.get('/purchase-orders/:id/pdf', authenticateToken, async (req, res) => {
    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (poResult.rows.length === 0) return res.status(404).send('Commande non trouvée.');
        const po = poResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [po.id]
        );

        const settingsResult = await pool.query('SELECT * FROM settings WHERE user_id = $1', [req.user.id]);
        const s = settingsResult.rows[0] || {};

        let supplier = { name: po.supplier_name };
        if (po.supplier_id) {
            const supResult = await pool.query('SELECT * FROM suppliers WHERE id = $1', [po.supplier_id]);
            if (supResult.rows.length > 0) {
                const sup = supResult.rows[0];
                supplier = {
                    name: sup.name,
                    contactName: sup.contact_name,
                    email: sup.email,
                    phone: sup.phone,
                    address: sup.address
                };
            }
        }

        const company = {
            companyName: s.company_name,
            address: s.address,
            email: s.email,
            phone: s.phone
        };

        const pdfBytes = await generatePurchaseOrderPDF(
            {
                poNumber: po.po_number,
                issueDate: po.issue_date,
                expectedDate: po.expected_date,
                total: parseFloat(po.total) || 0,
                notes: po.notes
            },
            itemsResult.rows,
            company,
            supplier,
            s.language || 'fr'
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=BC_${po.po_number}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur PDF.');
    }
});

// ============================================================
// GET /api/stock/purchase-orders/:id/logs — Historique
// ============================================================
router.get('/purchase-orders/:id/logs', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            SELECT * FROM purchase_order_logs
            WHERE purchase_order_id = $1 AND user_id = $2
            ORDER BY created_at DESC
            LIMIT 50
        `, [id, req.user.id]);

        res.json(result.rows.map(l => ({
            id: l.id,
            action: l.action,
            details: l.details,
            errorMessage: l.error_message,
            createdAt: l.created_at
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/stock/purchase-orders/:id — Supprimer (brouillon seulement)
// ============================================================
router.delete('/purchase-orders/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM purchase_orders
            WHERE id = $1 AND user_id = $2 AND status = 'draft'
            RETURNING id
        `, [req.params.id, req.user.id]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Seules les commandes en brouillon peuvent être supprimées.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;