// backend/routes/stock.js
// Gestion du stock + commandes fournisseurs

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generatePurchaseOrderPDF } = require('../utils/pdf-generator-po');

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

        // Vérifier que le produit appartient à l'utilisateur
        const prodResult = await client.query(
            'SELECT id, stock_quantity FROM products WHERE id = $1 AND user_id = $2',
            [productId, req.user.id]
        );
        if (prodResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Produit non trouvé.' });
        }
        const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;

        // Calculer le nouveau stock
        let newStock = currentStock;
        if (movementType === 'in') newStock = currentStock + qty;
        else if (movementType === 'out') newStock = currentStock - qty;
        else if (movementType === 'adjustment') newStock = qty;

        // Enregistrer le mouvement
        await client.query(`
            INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.user.id, productId, movementType, qty, reason || null, reference || null]);

        // Mettre à jour le stock
        await client.query(
            'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
            [newStock, productId]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            newStock,
            productId
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

        // Récupérer la facture
        const invResult = await client.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (invResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Facture non trouvée.' });
        }
        const invoice = invResult.rows[0];

        // Vérifier si déjà synchronisée
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
            // Trouver le produit par référence
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

        // 1. Récupérer les produits en alerte avec fournisseur
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

        // 2. Grouper par fournisseur
        const bySupplier = {};
        for (const row of alerts.rows) {
            if (!bySupplier[row.supplier_id]) bySupplier[row.supplier_id] = [];
            bySupplier[row.supplier_id].push(row);
        }

        const createdPOs = [];

        // 3. Pour chaque fournisseur, créer une commande
        for (const [supplierId, products] of Object.entries(bySupplier)) {
            // Récupérer infos fournisseur
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1',
                [supplierId]
            );
            if (supplierResult.rows.length === 0) continue;
            const supplier = supplierResult.rows[0];

            // Numéro de commande
            const counterResult = await client.query(`
                SELECT COUNT(*) FROM purchase_orders WHERE user_id = $1
            `, [req.user.id]);
            const nextNum = parseInt(counterResult.rows[0].count) + 1;
            const poNumber = `PO-${String(nextNum).padStart(4, '0')}-${new Date().getFullYear()}`;

            // Calculer totaux
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
                    unitPrice,
                    total
                };
            });

            // Date de livraison souhaitée
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() + (supplier.delivery_days || 7));

            // Créer la commande
            const poResult = await client.query(`
                INSERT INTO purchase_orders (
                    user_id, po_number, supplier_id, supplier_name, status,
                    issue_date, expected_date, subtotal, total
                )
                VALUES ($1, $2, $3, $4, 'draft', NOW(), $5, $6, $6)
                RETURNING id, po_number
            `, [
                req.user.id, poNumber, supplierId, supplier.name,
                expectedDate.toISOString().slice(0, 10), subtotal
            ]);

            const poId = poResult.rows[0].id;

            // Insérer les lignes
            for (const item of items) {
                await client.query(`
                    INSERT INTO purchase_order_items (purchase_order_id, product_id, product_ref, product_name, quantity, unit_price, total)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [poId, item.productId, item.ref, item.name, item.quantity, item.unitPrice, item.total]);
            }

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
        const result = await pool.query(`
            SELECT po.*, 
                   (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as items_count
            FROM purchase_orders po
            WHERE po.user_id = $1
            ORDER BY po.created_at DESC
            LIMIT 200
        `, [req.user.id]);

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
            notes: po.notes
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
            items: itemsResult.rows.map(i => ({
                id: i.id,
                productId: i.product_id,
                productRef: i.product_ref,
                productName: i.product_name,
                quantity: parseFloat(i.quantity),
                unitPrice: parseFloat(i.unit_price),
                total: parseFloat(i.total)
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
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
        const receivedDate = status === 'received' ? new Date() : null;

        const result = await pool.query(`
            UPDATE purchase_orders
            SET status = $1,
                received_date = CASE WHEN $1 = 'received' THEN NOW() ELSE received_date END,
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
            RETURNING id, status
        `, [status, req.params.id, req.user.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvée.' });

        res.json({ success: true, status: result.rows[0].status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/stock/purchase-orders/:id/receive — Réceptionner
// (met à jour le stock automatiquement)
// ============================================================
router.post('/purchase-orders/:id/receive', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Récupérer la commande
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

        // Récupérer les lignes
        const itemsResult = await client.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [po.id]
        );

        // Pour chaque ligne, ajouter au stock
        for (const item of itemsResult.rows) {
            if (!item.product_id) continue;

            const prodResult = await client.query(
                'SELECT stock_quantity FROM products WHERE id = $1',
                [item.product_id]
            );
            if (prodResult.rows.length === 0) continue;
            const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;
            const newStock = currentStock + parseFloat(item.quantity);

            await client.query(
                'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                [newStock, item.product_id]
            );

            await client.query(`
                INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason, reference, related_purchase_order_id)
                VALUES ($1, $2, 'purchase', $3, $4, $5, $6)
            `, [req.user.id, item.product_id, item.quantity, 'Réception ' + po.po_number, po.po_number, po.id]);
        }

        // Marquer la commande comme reçue
        await client.query(
            'UPDATE purchase_orders SET status = $1, received_date = NOW(), updated_at = NOW() WHERE id = $2',
            ['received', po.id]
        );

        await client.query('COMMIT');

        res.json({ success: true, items: itemsResult.rows.length });
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