// Gestion des factures

const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { generateInvoicePDF } = require('../utils/pdf-generator-invoice');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

// ============================================================
// GET /api/invoices — Liste des factures
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM invoices
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 200
        `, [req.user.id]);

        res.json(result.rows.map(i => ({
            id: i.id,
            invoiceNumber: i.invoice_number,
            quoteId: i.quote_id,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            subtotal: parseFloat(i.subtotal) || 0,
            vatAmount: parseFloat(i.vat_amount) || 0,
            total: parseFloat(i.total),
            vatRegime: i.vat_regime,
            status: i.status || 'draft',
            paidAt: i.paid_at,
            paymentMethod: i.payment_method,
            clientName: i.client_name,
            clientEmail: i.client_email,
            items: i.items
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/invoices/:id — Détail d'une facture
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });
        const i = result.rows[0];
        res.json({
            id: i.id,
            invoiceNumber: i.invoice_number,
            quoteId: i.quote_id,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            subtotal: parseFloat(i.subtotal) || 0,
            vatAmount: parseFloat(i.vat_amount) || 0,
            total: parseFloat(i.total),
            vatRegime: i.vat_regime,
            status: i.status,
            paidAt: i.paid_at,
            paymentMethod: i.payment_method,
            items: i.items,
            clientId: i.client_id,
            clientName: i.client_name,
            clientAddress: i.client_address,
            clientVat: i.client_vat,
            clientEmail: i.client_email,
            notes: i.notes
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/invoices — Créer une facture (depuis zéro ou depuis un devis)
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { quoteId, items, client, vatRegime, vatRate, dueDate, notes, status } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    const clientPg = await pool.connect();
    try {
        await clientPg.query('BEGIN');

        // Calcul des totaux
        const subtotal = items.reduce((sum, it) => sum + (parseFloat(it.total) || 0), 0);
        const vatAmount = vatRegime === 'assujetti' ? subtotal * ((parseFloat(vatRate) || 0) / 100) : 0;
        const total = subtotal + vatAmount;

        // Numéro de facture
        const counterResult = await clientPg.query(
            'SELECT last_number FROM invoice_counters WHERE user_id = $1',
            [req.user.id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await clientPg.query(
                'UPDATE invoice_counters SET last_number = $1 WHERE user_id = $2',
                [newNumber, req.user.id]
            );
        } else {
            await clientPg.query(
                'INSERT INTO invoice_counters (user_id, last_number) VALUES ($1, 1)',
                [req.user.id]
            );
        }

        // Préfixe personnalisé
        const settingsResult = await clientPg.query(
            'SELECT invoice_prefix, payment_terms FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const prefix = settingsResult.rows[0]?.invoice_prefix || 'FAC';
        const defaultTerms = settingsResult.rows[0]?.payment_terms || 30;

        const invoiceNumber = `${prefix}-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

        // Dates
        const issueDate = new Date().toISOString().slice(0, 10);
        let dueDateFinal = dueDate;
        if (!dueDateFinal) {
            const d = new Date();
            d.setDate(d.getDate() + defaultTerms);
            dueDateFinal = d.toISOString().slice(0, 10);
        }

        const result = await clientPg.query(`
            INSERT INTO invoices (
                user_id, invoice_number, quote_id, issue_date, due_date,
                subtotal, vat_amount, total, vat_regime, status,
                items, client_id, client_name, client_address, client_vat, client_email, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id, invoice_number
        `, [
            req.user.id,
            invoiceNumber,
            quoteId || null,
            issueDate,
            dueDateFinal,
            subtotal,
            vatAmount,
            total,
            vatRegime,
            status || 'draft',
            JSON.stringify(items),
            client?.id || null,
            client?.name || null,
            client?.address || null,
            client?.vat || null,
            client?.email || null,
            notes || null
        ]);

        await clientPg.query('COMMIT');

        res.json({
            success: true,
            id: result.rows[0].id,
            invoiceNumber: result.rows[0].invoice_number
        });
    } catch (err) {
        await clientPg.query('ROLLBACK');
        console.error('Erreur création facture:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        clientPg.release();
    }
});

// ============================================================
// PUT /api/invoices/:id — Modifier une facture
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const { items, client, vatRegime, vatRate, dueDate, notes } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un article est requis.' });

    try {
        const subtotal = items.reduce((sum, it) => sum + (parseFloat(it.total) || 0), 0);
        const vatAmount = vatRegime === 'assujetti' ? subtotal * ((parseFloat(vatRate) || 0) / 100) : 0;
        const total = subtotal + vatAmount;

        const result = await pool.query(`
            UPDATE invoices
            SET items = $1,
                subtotal = $2,
                vat_amount = $3,
                total = $4,
                vat_regime = $5,
                due_date = $6,
                client_name = $7,
                client_address = $8,
                client_vat = $9,
                client_email = $10,
                notes = $11,
                updated_at = NOW()
            WHERE id = $12 AND user_id = $13
            RETURNING id
        `, [
            JSON.stringify(items), subtotal, vatAmount, total, vatRegime,
            dueDate, client?.name || null, client?.address || null,
            client?.vat || null, client?.email || null, notes || null,
            req.params.id, req.user.id
        ]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/invoices/:id/status — Changer le statut
// ============================================================
router.put('/:id/status', authenticateToken, async (req, res) => {
    const { status, paymentMethod } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });

    try {
        const paidAt = status === 'paid' ? new Date() : null;

        const result = await pool.query(`
            UPDATE invoices
            SET status = $1,
                paid_at = CASE WHEN $1 = 'paid' THEN $2 ELSE paid_at END,
                payment_method = CASE WHEN $1 = 'paid' THEN $3 ELSE payment_method END,
                updated_at = NOW()
            WHERE id = $4 AND user_id = $5
            RETURNING id, status
        `, [status, paidAt, paymentMethod || null, req.params.id, req.user.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });
        res.json({ success: true, status: result.rows[0].status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/invoices/:id — Supprimer une facture
// ============================================================
router.delete('/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/invoices/:id/pdf — Télécharger le PDF
// ============================================================
router.get('/:id/pdf', authenticateToken, async (req, res) => {
    try {
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (invoiceResult.rows.length === 0) return res.status(404).send('Facture non trouvée.');
        const invoice = invoiceResult.rows[0];

        const settingsResult = await pool.query('SELECT * FROM settings WHERE user_id = $1', [req.user.id]);
        const s = settingsResult.rows[0] || {};

        const company = {
            companyName: s.company_name,
            address: s.address,
            siret: s.siret,
            tva: s.tva,
            phone: s.phone,
            email: s.email,
            website: s.website,
            logo: s.logo,
            iban: s.iban,
            bic: s.bic,
            bank_name: s.bank_name,
            vatRegime: s.vat_regime,
            vatRate: parseFloat(s.vat_rate) || 21
        };

        const client = {
            name: invoice.client_name,
            address: invoice.client_address,
            vat: invoice.client_vat,
            email: invoice.client_email
        };

        const pdfBytes = await generateInvoicePDF(
            invoice.items,
            parseFloat(invoice.subtotal) || 0,
            parseFloat(invoice.vat_amount) || 0,
            parseFloat(invoice.total),
            invoice.vat_regime,
            parseFloat(s.vat_rate) || 21,
            invoice.invoice_number,
            invoice.issue_date,
            invoice.due_date,
            invoice.status,
            invoice.notes,
            company,
            client,
            s.language || 'fr',
            s.pdf_template || 'classic'
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=facture_${invoice.invoice_number}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur PDF.');
    }
});

module.exports = router;