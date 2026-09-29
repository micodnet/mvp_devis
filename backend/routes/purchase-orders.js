// backend/routes/purchase-orders.js
// Routes pour les bons de commande fournisseurs

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { Resend } = require('resend');
const {
    STATUSES,
    computeTotals,
    createPurchaseOrder,
    prepareFromLowStock,
    prepareFromQuote,
    receivePurchaseOrder
} = require('../utils/purchase-orders/helpers');
const { generatePurchaseOrderPDF } = require('../utils/purchase-orders/pdf-generator');

const router = express.Router();

// ============================================================
// GET /api/purchase-orders/meta — Statuts disponibles
// ============================================================
router.get('/meta', authenticateToken, (req, res) => {
    res.json({
        statuses: Object.entries(STATUSES).map(([key, val]) => ({
            key,
            label: val.label,
            color: val.color
        }))
    });
});

// ============================================================
// GET /api/purchase-orders — Liste des bons de commande
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, supplierId, limit } = req.query;

        let query = `
            SELECT po.*,
                (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) as items_count
            FROM purchase_orders po
            WHERE po.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ' AND po.status = $' + params.length;
        }

        if (supplierId) {
            params.push(parseInt(supplierId));
            query += ' AND po.supplier_id = $' + params.length;
        }

        query += ' ORDER BY po.created_at DESC LIMIT $' + (params.length + 1);
        params.push(Math.min(parseInt(limit) || 100, 500));

        const result = await pool.query(query, params);

        res.json(result.rows.map(po => ({
            id: po.id,
            poNumber: po.po_number,
            supplierId: po.supplier_id,
            supplierName: po.supplier_name,
            supplierEmail: po.supplier_email,
            orderDate: po.order_date,
            expectedDate: po.expected_date,
            receivedDate: po.received_date,
            status: po.status,
            subtotal: parseFloat(po.subtotal),
            vatAmount: parseFloat(po.vat_amount),
            total: parseFloat(po.total),
            source: po.source,
            sourceReference: po.source_reference,
            sentAt: po.sent_at,
            sentToEmail: po.sent_to_email,
            itemsCount: parseInt(po.items_count),
            notes: po.notes,
            createdAt: po.created_at,
            updatedAt: po.updated_at
        })));
    } catch (err) {
        console.error('Erreur list purchase orders:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/:id — Detail d'un BC
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (poResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        const po = poResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id ASC',
            [id]
        );

        const logsResult = await pool.query(`
            SELECT * FROM purchase_order_logs
            WHERE purchase_order_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [id]);

        res.json({
            id: po.id,
            poNumber: po.po_number,
            supplierId: po.supplier_id,
            supplierName: po.supplier_name,
            supplierEmail: po.supplier_email,
            supplierAddress: po.supplier_address,
            supplierVat: po.supplier_vat,
            orderDate: po.order_date,
            expectedDate: po.expected_date,
            receivedDate: po.received_date,
            status: po.status,
            subtotal: parseFloat(po.subtotal),
            vatAmount: parseFloat(po.vat_amount),
            total: parseFloat(po.total),
            notes: po.notes,
            source: po.source,
            sourceReference: po.source_reference,
            sentAt: po.sent_at,
            sentToEmail: po.sent_to_email,
            createdAt: po.created_at,
            updatedAt: po.updated_at,
            items: itemsResult.rows.map(item => ({
                id: item.id,
                productId: item.product_id,
                productRef: item.product_ref,
                productName: item.product_name,
                quantity: parseFloat(item.quantity),
                unit: item.unit,
                unitPrice: parseFloat(item.unit_price),
                total: parseFloat(item.total),
                quantityReceived: parseFloat(item.quantity_received) || 0
            })),
            logs: logsResult.rows.map(log => ({
                id: log.id,
                action: log.action,
                details: log.details,
                errorMessage: log.error_message,
                createdAt: log.created_at
            }))
        });
    } catch (err) {
        console.error('Erreur get purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders — Creer un BC manuellement
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        supplierId, supplierName, supplierEmail, supplierAddress, supplierVat,
        items, orderDate, expectedDate, notes
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    try {
        const po = await createPurchaseOrder(req.user.id, {
            supplierId,
            supplierName,
            supplierEmail,
            supplierAddress,
            supplierVat,
            items,
            orderDate,
            expectedDate,
            notes,
            source: 'manual'
        });

        res.json({ success: true, purchaseOrder: po });
    } catch (err) {
        console.error('Erreur create purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/purchase-orders/:id — Modifier un BC
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const {
        supplierId, supplierName, supplierEmail, supplierAddress, supplierVat,
        items, orderDate, expectedDate, notes
    } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verifier que le BC existe et est en brouillon
        const checkResult = await client.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        const po = checkResult.rows[0];

        if (po.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Seul un brouillon peut etre modifie.' });
        }

        // Charger les settings pour la TVA
        const settingsResult = await client.query(
            'SELECT vat_rate FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const vatRate = parseFloat(settingsResult.rows[0]?.vat_rate) || 21;

        const totals = computeTotals(items || [], vatRate);

        if (totals.items.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Au moins un article est requis.' });
        }

        // Charger le fournisseur si fourni
        let supplier = null;
        if (supplierId) {
            const supplierResult = await client.query(
                'SELECT * FROM suppliers WHERE id = $1 AND user_id = $2',
                [supplierId, req.user.id]
            );
            if (supplierResult.rows.length > 0) {
                supplier = supplierResult.rows[0];
            }
        }

        // Mettre a jour le BC
        await client.query(`
            UPDATE purchase_orders SET
                supplier_id = $1,
                supplier_name = $2,
                supplier_email = $3,
                supplier_address = $4,
                supplier_vat = $5,
                order_date = $6,
                expected_date = $7,
                subtotal = $8,
                vat_amount = $9,
                total = $10,
                notes = $11,
                updated_at = NOW()
            WHERE id = $12 AND user_id = $13
        `, [
            supplierId || null,
            supplierName || (supplier ? supplier.name : null),
            supplierEmail || (supplier ? supplier.email : null),
            supplierAddress || (supplier ? supplier.address : null),
            supplierVat || (supplier ? supplier.vat_number : null),
            orderDate || po.order_date,
            expectedDate || null,
            totals.subtotal,
            totals.vatAmount,
            totals.total,
            notes !== undefined ? notes : po.notes,
            id,
            req.user.id
        ]);

        // Supprimer les anciens items et reinserer
        await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id]);

        for (const item of totals.items) {
            await client.query(`
                INSERT INTO purchase_order_items (
                    purchase_order_id, product_id, product_ref, product_name,
                    quantity, unit, unit_price, total
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                id,
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
            VALUES ($1, $2, 'updated', $3)
        `, [req.user.id, id, JSON.stringify({ itemsCount: totals.items.length, total: totals.total })]);

        await client.query('COMMIT');

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur update purchase order:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================
// POST /api/purchase-orders/:id/validate — Valider (draft -> sent)
// ============================================================
router.post('/:id/validate', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const checkResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        if (checkResult.rows[0].status !== 'draft') {
            return res.status(400).json({ error: 'Seul un brouillon peut etre valide.' });
        }

        await pool.query(`
            UPDATE purchase_orders
            SET status = 'sent', sent_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND user_id = $2
        `, [id, req.user.id]);

        await pool.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action)
            VALUES ($1, $2, 'validated')
        `, [req.user.id, id]);

        res.json({ success: true, status: 'sent' });
    } catch (err) {
        console.error('Erreur validate purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders/:id/send-email — Envoyer par email
// ============================================================
router.post('/:id/send-email', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { email } = req.body;

    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (poResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        const po = poResult.rows[0];
        const finalEmail = email || po.supplier_email;

        if (!finalEmail) {
            return res.status(400).json({ error: 'Aucun email fournisseur. Precisez-en un.' });
        }

        // Charger les items
        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [id]
        );

        // Charger la company
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const company = settingsResult.rows[0] || {};

        // Generer le PDF
        const pdfBytes = await generatePurchaseOrderPDF(
            po,
            itemsResult.rows,
            company,
            {
                name: po.supplier_name,
                email: po.supplier_email,
                address: po.supplier_address,
                vat: po.supplier_vat
            }
        );

        // Envoyer via Resend
        if (process.env.RESEND_API_KEY) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const companyName = company.company_name || 'Notre entreprise';
            const total = parseFloat(po.total).toFixed(2);

            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Bon de commande <noreply@votreentreprise.com>',
                to: [finalEmail],
                subject: 'Bon de commande ' + po.po_number + ' - ' + companyName,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h1 style="color:#0b1120;font-size:22px;margin-bottom:16px;">Bon de commande ${po.po_number}</h1>
                        <p>Bonjour ${po.supplier_name || ''},</p>
                        <p>Veuillez trouver ci-joint notre bon de commande d'un montant de <strong>${total} EUR</strong>.</p>
                        ${po.expected_date ? '<p>Date de livraison souhaitee : <strong>' + new Date(po.expected_date).toLocaleDateString('fr-FR') + '</strong></p>' : ''}
                        <p>Cordialement,<br>${companyName}</p>
                    </div>
                `,
                attachments: [{
                    filename: 'BC_' + po.po_number + '.pdf',
                    content: Buffer.from(pdfBytes).toString('base64'),
                    contentType: 'application/pdf'
                }]
            });
        } else {
            console.warn('RESEND_API_KEY absente - email non envoye');
        }

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

        res.json({ success: true, sentTo: finalEmail });
    } catch (err) {
        console.error('Erreur send purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/:id/pdf — Telecharger le PDF
// ============================================================
router.get('/:id/pdf', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const poResult = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (poResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        const po = poResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
            [id]
        );

        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const company = settingsResult.rows[0] || {};

        const pdfBytes = await generatePurchaseOrderPDF(
            po,
            itemsResult.rows,
            company,
            {
                name: po.supplier_name,
                email: po.supplier_email,
                address: po.supplier_address,
                vat: po.supplier_vat
            }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="BC_' + po.po_number + '.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Erreur pdf purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders/:id/receive — Receptionner
// ============================================================
router.post('/:id/receive', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { receivedItems } = req.body;

    try {
        const result = await receivePurchaseOrder(req.user.id, id, receivedItems);
        res.json(result);
    } catch (err) {
        console.error('Erreur receive purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders/:id/cancel — Annuler
// ============================================================
router.post('/:id/cancel', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(`
            UPDATE purchase_orders
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND user_id = $2 AND status != 'received'
            RETURNING id
        `, [id, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Impossible d\'annuler ce bon de commande.' });
        }

        await pool.query(`
            INSERT INTO purchase_order_logs (user_id, purchase_order_id, action)
            VALUES ($1, $2, 'cancelled')
        `, [req.user.id, id]);

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur cancel purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/purchase-orders/:id — Supprimer
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM purchase_orders WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bon de commande introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur delete purchase order:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/purchase-orders/scan-stock — Detecter et preparer les BC
// ============================================================
router.post('/scan-stock', authenticateToken, async (req, res) => {
    try {
        const result = await prepareFromLowStock(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Erreur scan stock:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/purchase-orders/stats/summary — Stats globales
// ============================================================
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'draft') as draft,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'partial') as partial,
                COUNT(*) FILTER (WHERE status = 'received') as received,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
                COALESCE(SUM(total), 0) as total_amount,
                COALESCE(SUM(total) FILTER (WHERE status = 'draft'), 0) as draft_amount
            FROM purchase_orders
            WHERE user_id = $1
        `, [req.user.id]);

        const r = result.rows[0];

        res.json({
            total: parseInt(r.total),
            draft: parseInt(r.draft),
            sent: parseInt(r.sent),
            partial: parseInt(r.partial),
            received: parseInt(r.received),
            cancelled: parseInt(r.cancelled),
            totalAmount: parseFloat(r.total_amount),
            draftAmount: parseFloat(r.draft_amount)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;