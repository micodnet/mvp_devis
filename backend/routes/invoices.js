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
            peppolOrderId: i.peppol_order_id,
            peppolSentAt: i.peppol_sent_at,
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

// ============================================================
// POST /api/invoices/:id/send-peppol — Envoyer la facture via Peppol (Billit)
// ============================================================
router.post('/:id/send-peppol', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    const { createInvoiceInBillit, sendViaPeppol } = require('../utils/peppol-billit');

    try {
        // 1. Récupérer la facture
        const invResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (invResult.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });
        const invoice = invResult.rows[0];

        // 2. Vérifier qu'elle n'a pas déjà été envoyée
        if (invoice.peppol_order_id && invoice.peppol_sent_at) {
            return res.status(400).json({
                error: 'Cette facture a déjà été envoyée via Peppol.',
                orderId: invoice.peppol_order_id,
                sentAt: invoice.peppol_sent_at
            });
        }

        // 3. Récupérer les paramètres entreprise (IBAN, TVA...)
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const s = settingsResult.rows[0] || {};

        // 4. Vérifications obligatoires Peppol
        if (!invoice.client_name) {
            return res.status(400).json({ error: 'Le nom du client est requis pour Peppol.' });
        }
        if (!s.siret) {
            return res.status(400).json({ error: 'Votre numéro BCE est requis dans les Paramètres.' });
        }

        // 5. Créer la facture chez Billit
        const payload = {
            invoiceNumber: invoice.invoice_number,
            issueDate: invoice.issue_date,
            dueDate: invoice.due_date,
            clientName: invoice.client_name,
            clientVat: invoice.client_vat,
            clientEmail: invoice.client_email,
            items: invoice.items,
            vatRegime: invoice.vat_regime,
            vatRate: parseFloat(s.vat_rate) || 21,
            companyIban: s.iban
        };

        const orderId = await createInvoiceInBillit(payload);

        // 6. Envoyer via Peppol
        await sendViaPeppol(orderId);

        // 7. Sauvegarder l'OrderID en base
        await pool.query(`
            UPDATE invoices
            SET status = 'sent',
                peppol_order_id = $1,
                peppol_sent_at = NOW(),
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        `, [String(orderId), invoiceId, req.user.id]);

        res.json({
            success: true,
            orderId,
            message: 'Facture envoyée via Peppol.'
        });
    } catch (err) {
        console.error('Erreur send-peppol:', err);
        res.status(500).json({ error: err.message || 'Erreur envoi Peppol.' });
    }
});

// ============================================================
// GET /api/invoices/:id/peppol-status — Récupérer le statut d'envoi
// ============================================================
router.get('/:id/peppol-status', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    const { getInvoiceStatus } = require('../utils/peppol-billit');

    try {
        const result = await pool.query(
            'SELECT peppol_order_id FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée.' });

        const orderId = result.rows[0].peppol_order_id;
        if (!orderId) {
            return res.json({ status: 'not_sent', delivered: false });
        }

        const status = await getInvoiceStatus(orderId);
        res.json({ orderId, ...status });
    } catch (err) {
        console.error('Erreur peppol-status:', err);
        res.status(500).json({ error: err.message });
    }
});

const { 
    generateInvoiceNumber, 
    computeTotals, 
    computeDeposit,
    updateInvoicePaymentState,
    generateAccountingCSV,
    findInvoicesToRemind
} = require('../utils/invoice-helpers');

// ============================================================
// POST /api/invoices/from-quote/:quoteId — Créer une facture depuis un devis
// ============================================================
router.post('/from-quote/:quoteId', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.quoteId);
    const { depositPercent = 0 } = req.body;

    try {
        // Charger le devis
        const quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );
        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }
        const quote = quoteResult.rows[0];

        // Charger les settings pour la TVA
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};

        const items = Array.isArray(quote.items) ? quote.items : [];
        const totals = computeTotals(items, settings.vat_regime || 'franchise', parseFloat(settings.vat_rate) || 21);

        // Acompte ?
        let invoiceType = 'invoice';
        let subtotal = totals.subtotal;
        let total = totals.total;

        if (depositPercent > 0 && depositPercent < 100) {
            invoiceType = 'deposit';
            subtotal = computeDeposit(totals.subtotal, depositPercent);
            total = computeDeposit(totals.total, depositPercent);
        }

        // Numéro de facture
        const invoiceNumber = await generateInvoiceNumber(req.user.id, invoiceType);

        // Dates
        const issueDate = new Date().toISOString().slice(0, 10);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (parseInt(settings.payment_terms) || 30));

        // Insérer
        const result = await pool.query(`
            INSERT INTO invoices (
                user_id, invoice_number, invoice_type, issue_date, due_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_name, client_address, client_vat, client_email,
                quote_id, deposit_percent, amount_due
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10,
                    $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `, [
            req.user.id, invoiceNumber, invoiceType, issueDate, dueDate.toISOString().slice(0, 10),
            subtotal, totals.vatAmount, total, settings.vat_regime || 'franchise',
            JSON.stringify(items),
            quote.client_name, quote.client_address, quote.client_vat, quote.client_email,
            quoteId, depositPercent || null, total
        ]);

        res.json({ success: true, invoice: result.rows[0] });
    } catch (err) {
        console.error('Erreur from-quote:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/invoices/:id/duplicate — Dupliquer une facture
// ============================================================
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const originalResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (originalResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }
        const original = originalResult.rows[0];

        // Nouveau numéro
        const newNumber = await generateInvoiceNumber(req.user.id, original.invoice_type || 'invoice');

        // Nouvelles dates
        const issueDate = new Date().toISOString().slice(0, 10);
        const settingsResult = await pool.query(
            'SELECT payment_terms FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const paymentTerms = parseInt(settingsResult.rows[0]?.payment_terms) || 30;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + paymentTerms);

        // Insérer la copie
        const result = await pool.query(`
            INSERT INTO invoices (
                user_id, invoice_number, invoice_type, issue_date, due_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_id, client_name, client_address, client_vat, client_email,
                notes, amount_due
            )
            SELECT 
                user_id, $1, invoice_type, $2, $3,
                subtotal, vat_amount, total, vat_regime, 'draft', items,
                client_id, client_name, client_address, client_vat, client_email,
                notes, total
            FROM invoices WHERE id = $4
            RETURNING *
        `, [newNumber, issueDate, dueDate.toISOString().slice(0, 10), id]);

        res.json({ success: true, invoice: result.rows[0] });
    } catch (err) {
        console.error('Erreur duplicate:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/invoices/:id/credit-note — Créer un avoir
// ============================================================
router.post('/:id/credit-note', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const { reason = 'Annulation', amount = null, fullCredit = true } = req.body;

    try {
        const originalResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (originalResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }
        const original = originalResult.rows[0];

        if (original.invoice_type === 'credit_note') {
            return res.status(400).json({ error: 'Impossible de créer un avoir sur un avoir.' });
        }

        // Numéro d'avoir
        const creditNumber = await generateInvoiceNumber(req.user.id, 'credit_note');

        // Montants
        const originalTotal = parseFloat(original.total);
        const creditAmount = fullCredit ? originalTotal : parseFloat(amount);
        if (isNaN(creditAmount) || creditAmount <= 0 || creditAmount > originalTotal) {
            return res.status(400).json({ error: 'Montant d\'avoir invalide.' });
        }

        const ratio = creditAmount / originalTotal;
        const creditSubtotal = Math.round(parseFloat(original.subtotal) * ratio * 100) / 100;
        const creditVat = Math.round(parseFloat(original.vat_amount) * ratio * 100) / 100;

        const issueDate = new Date().toISOString().slice(0, 10);

        const result = await pool.query(`
            INSERT INTO invoices (
                user_id, invoice_number, invoice_type, parent_invoice_id,
                issue_date, due_date, subtotal, vat_amount, total, vat_regime,
                status, items, client_id, client_name, client_address, client_vat, client_email,
                notes, amount_due
            )
            VALUES ($1, $2, 'credit_note', $3, $4, $4, $5, $6, $7, $8,
                    'draft', $9, $10, $11, $12, $13, $14, $15, $7)
            RETURNING *
        `, [
            req.user.id, creditNumber, id,
            issueDate,
            -creditSubtotal, -creditVat, -creditAmount,
            original.vat_regime || 'franchise',
            JSON.stringify(original.items),
            original.client_id, original.client_name, original.client_address,
            original.client_vat, original.client_email,
            `Avoir sur facture ${original.invoice_number} : ${reason}`
        ]);

        res.json({ success: true, creditNote: result.rows[0] });
    } catch (err) {
        console.error('Erreur credit-note:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/invoices/:id/payments — Enregistrer un paiement
// ============================================================
router.post('/:id/payments', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const { amount, paymentDate, paymentMethod, reference, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'Montant invalide.' });
    }

    try {
        // Vérifier la facture
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }

        // Insérer le paiement
        const result = await pool.query(`
            INSERT INTO invoice_payments (user_id, invoice_id, amount, payment_date, payment_method, reference, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            req.user.id, id, parseFloat(amount),
            paymentDate || new Date().toISOString().slice(0, 10),
            paymentMethod || null, reference || null, notes || null
        ]);

        // Recalculer l'état
        const state = await updateInvoicePaymentState(id);

        res.json({ 
            success: true, 
            payment: result.rows[0],
            invoiceState: state
        });
    } catch (err) {
        console.error('Erreur payment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/invoices/:id/payments — Historique des paiements
// ============================================================
router.get('/:id/payments', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'SELECT * FROM invoice_payments WHERE invoice_id = $1 AND user_id = $2 ORDER BY payment_date DESC',
            [id, req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/invoices/export/csv — Export comptable
// ============================================================
router.get('/export/csv', authenticateToken, async (req, res) => {
    try {
        const { from, to, status } = req.query;

        let query = 'SELECT * FROM invoices WHERE user_id = $1';
        const params = [req.user.id];

        if (from) {
            params.push(from);
            query += ` AND issue_date >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            query += ` AND issue_date <= $${params.length}`;
        }
        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }

        query += ' ORDER BY issue_date DESC';

        const result = await pool.query(query, params);

        const settingsResult = await pool.query(
            'SELECT company_name FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const companyName = settingsResult.rows[0]?.company_name || '';

        const csv = generateAccountingCSV(result.rows, companyName);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=export-factures-${new Date().toISOString().slice(0, 10)}.csv`);
        res.send('\uFEFF' + csv); // BOM pour Excel
    } catch (err) {
        console.error('Erreur export CSV:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/invoices/reminders/settings — Paramètres de relance
// ============================================================
router.get('/reminders/settings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM reminder_settings WHERE user_id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                daysBeforeFirst: 7,
                daysBetweenReminders: 7,
                maxReminders: 3
            });
        }
        const s = result.rows[0];
        res.json({
            enabled: s.enabled,
            daysBeforeFirst: s.days_before_first,
            daysBetweenReminders: s.days_between_reminders,
            maxReminders: s.max_reminders,
            emailSubjectTemplate: s.email_subject_template,
            emailBodyTemplate: s.email_body_template
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/invoices/reminders/settings — Modifier paramètres
// ============================================================
router.post('/reminders/settings', authenticateToken, async (req, res) => {
    const { enabled, daysBeforeFirst, daysBetweenReminders, maxReminders, emailSubjectTemplate, emailBodyTemplate } = req.body;
    try {
        await pool.query(`
            INSERT INTO reminder_settings (user_id, enabled, days_before_first, days_between_reminders, max_reminders, email_subject_template, email_body_template, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                days_before_first = EXCLUDED.days_before_first,
                days_between_reminders = EXCLUDED.days_between_reminders,
                max_reminders = EXCLUDED.max_reminders,
                email_subject_template = EXCLUDED.email_subject_template,
                email_body_template = EXCLUDED.email_body_template,
                updated_at = NOW()
        `, [
            req.user.id, enabled || false,
            parseInt(daysBeforeFirst) || 7, parseInt(daysBetweenReminders) || 7,
            parseInt(maxReminders) || 3,
            emailSubjectTemplate || null, emailBodyTemplate || null
        ]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/invoices/:id/remind — Envoyer une relance manuelle
// ============================================================
router.post('/:id/remind', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        // Charger la facture
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }
        const invoice = invoiceResult.rows[0];

        if (!invoice.client_email) {
            return res.status(400).json({ error: 'Aucun email client. Ajoutez-en un d\'abord.' });
        }

        // Compter les relances précédentes
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM payment_reminders WHERE invoice_id = $1',
            [id]
        );
        const level = parseInt(countResult.rows[0].count) + 1;

        // Envoyer l'email (via Resend)
        const { Resend } = require('resend');
        if (process.env.RESEND_API_KEY) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const settingsResult = await pool.query(
                'SELECT company_name FROM settings WHERE user_id = $1',
                [req.user.id]
            );
            const companyName = settingsResult.rows[0]?.company_name || '';

            const subjects = {
                1: `Rappel amiable - Facture ${invoice.invoice_number}`,
                2: `Relance - Facture ${invoice.invoice_number}`,
                3: `Mise en demeure - Facture ${invoice.invoice_number}`
            };

            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'noreply@votreentreprise.com',
                to: [invoice.client_email],
                subject: subjects[Math.min(level, 3)],
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                        <h2>${subjects[Math.min(level, 3)]}</h2>
                        <p>Bonjour ${invoice.client_name || ''},</p>
                        <p>Nous vous rappelons que la facture <strong>${invoice.invoice_number}</strong> 
                           d'un montant de <strong>${parseFloat(invoice.amount_due || invoice.total).toFixed(2)} €</strong>
                           est arrivée à échéance le <strong>${new Date(invoice.due_date).toLocaleDateString('fr-FR')}</strong>.</p>
                        <p>Nous vous remercions de bien vouloir procéder au règlement dans les plus brefs délais.</p>
                        <p>Cordialement,<br>${companyName}</p>
                    </div>
                `
            });
        }

        // Enregistrer la relance
        await pool.query(`
            INSERT INTO payment_reminders (user_id, invoice_id, reminder_level, sent_to_email, status)
            VALUES ($1, $2, $3, $4, 'sent')
        `, [req.user.id, id, level, invoice.client_email]);

        res.json({ success: true, level, sentTo: invoice.client_email });
    } catch (err) {
        console.error('Erreur remind:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/invoices/:id/reminders — Historique des relances
// ============================================================
router.get('/:id/reminders', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'SELECT * FROM payment_reminders WHERE invoice_id = $1 AND user_id = $2 ORDER BY sent_at DESC',
            [id, req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
module.exports = router;