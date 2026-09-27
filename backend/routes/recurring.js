// backend/routes/recurring.js
// Routes pour les factures recurrentes

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    FREQUENCIES,
    STATUSES,
    computeNextIssueDate,
    processDueRecurringInvoices,
    computeRuleTotals
} = require('../utils/recurring/helpers');

const router = express.Router();

// ============================================================
// GET /api/recurring/meta — Frequences et statuts disponibles
// ============================================================
router.get('/meta', authenticateToken, (req, res) => {
    res.json({
        frequencies: Object.entries(FREQUENCIES).map(([key, val]) => ({
            key,
            label: val.label,
            months: val.months
        })),
        statuses: Object.entries(STATUSES).map(([key, val]) => ({
            key,
            label: val.label,
            color: val.color
        }))
    });
});

// ============================================================
// GET /api/recurring — Liste des regles
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status } = req.query;

        let query = `
            SELECT r.*,
                (SELECT COUNT(*) FROM recurring_invoice_logs l
                 WHERE l.recurring_id = r.id AND l.action = 'generated') as generated_count,
                (SELECT MAX(created_at) FROM recurring_invoice_logs l
                 WHERE l.recurring_id = r.id AND l.action = 'generated') as last_generated_at
            FROM recurring_invoices r
            WHERE r.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ' AND r.status = $' + params.length;
        }

        query += ' ORDER BY r.created_at DESC';

        const result = await pool.query(query, params);

        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            clientId: r.client_id,
            clientName: r.client_name,
            clientEmail: r.client_email,
            items: r.items || [],
            subtotal: parseFloat(r.subtotal),
            vatAmount: parseFloat(r.vat_amount),
            total: parseFloat(r.total),
            vatRegime: r.vat_regime,
            currency: r.currency || 'EUR',
            frequency: r.frequency,
            dayOfPeriod: r.day_of_period,
            startDate: r.start_date,
            endDate: r.end_date,
            maxOccurrences: r.max_occurrences,
            occurrencesCount: r.occurrences_count,
            paymentTerms: r.payment_terms,
            autoSendEmail: r.auto_send_email,
            autoSendPeppol: r.auto_send_peppol,
            status: r.status,
            nextIssueDate: r.next_issue_date,
            notes: r.notes,
            generatedCount: parseInt(r.generated_count),
            lastGeneratedAt: r.last_generated_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        })));
    } catch (err) {
        console.error('Erreur list recurring:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/recurring/:id — Detail d'une regle
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM recurring_invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Regle introuvable.' });
        }

        const r = result.rows[0];

        // Historique
        const logsResult = await pool.query(`
            SELECT l.*, i.total as invoice_total
            FROM recurring_invoice_logs l
            LEFT JOIN invoices i ON i.id = l.invoice_id
            WHERE l.recurring_id = $1
            ORDER BY l.created_at DESC
            LIMIT 50
        `, [id]);

        res.json({
            id: r.id,
            name: r.name,
            clientId: r.client_id,
            clientName: r.client_name,
            clientAddress: r.client_address,
            clientVat: r.client_vat,
            clientEmail: r.client_email,
            items: r.items || [],
            subtotal: parseFloat(r.subtotal),
            vatAmount: parseFloat(r.vat_amount),
            total: parseFloat(r.total),
            vatRegime: r.vat_regime,
            currency: r.currency,
            frequency: r.frequency,
            dayOfPeriod: r.day_of_period,
            startDate: r.start_date,
            endDate: r.end_date,
            maxOccurrences: r.max_occurrences,
            occurrencesCount: r.occurrences_count,
            paymentTerms: r.payment_terms,
            autoSendEmail: r.auto_send_email,
            autoSendPeppol: r.auto_send_peppol,
            status: r.status,
            nextIssueDate: r.next_issue_date,
            notes: r.notes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            logs: logsResult.rows.map(l => ({
                id: l.id,
                invoiceId: l.invoice_id,
                invoiceNumber: l.invoice_number,
                invoiceTotal: l.invoice_total ? parseFloat(l.invoice_total) : null,
                action: l.action,
                details: l.details,
                errorMessage: l.error_message,
                createdAt: l.created_at
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/recurring — Creer une regle
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        name, clientId, clientName, clientAddress, clientVat, clientEmail,
        items, vatRegime, currency, frequency, dayOfPeriod,
        startDate, endDate, maxOccurrences, paymentTerms,
        autoSendEmail, autoSendPeppol, notes
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom de la regle est requis.' });
    }
    if (!frequency || !FREQUENCIES[frequency]) {
        return res.status(400).json({ error: 'Frequence invalide.' });
    }
    if (!startDate) {
        return res.status(400).json({ error: 'La date de debut est requise.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    try {
        // Charger les settings pour la TVA par defaut
        const settingsResult = await pool.query(
            'SELECT vat_regime, vat_rate, payment_terms FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};

        const finalVatRegime = vatRegime || settings.vat_regime || 'franchise';
        const vatRate = parseFloat(settings.vat_rate) || 21;
        const totals = computeRuleTotals(items, finalVatRegime, vatRate);

        // Charger le client si clientId fourni
        let finalClientName = clientName;
        let finalClientAddress = clientAddress;
        let finalClientVat = clientVat;
        let finalClientEmail = clientEmail;

        if (clientId) {
            const clientResult = await pool.query(
                'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
                [clientId, req.user.id]
            );
            if (clientResult.rows.length > 0) {
                const c = clientResult.rows[0];
                finalClientName = finalClientName || c.name;
                finalClientAddress = finalClientAddress || c.address;
                finalClientVat = finalClientVat || c.vat_number;
                finalClientEmail = finalClientEmail || c.email;
            }
        }

        // Calculer la prochaine date
        const ruleForCalc = {
            frequency,
            day_of_period: dayOfPeriod ? parseInt(dayOfPeriod) : null,
            start_date: startDate
        };

        // La premiere emission est a start_date
        // Ensuite on avance
        const startDateObj = new Date(startDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let nextIssueDate;
        if (startDateObj <= today) {
            // Si la date de debut est dans le passe, la prochaine emission est aujourd'hui ou la suivante
            nextIssueDate = new Date().toISOString().slice(0, 10);
        } else {
            nextIssueDate = startDate;
        }

        const result = await pool.query(`
            INSERT INTO recurring_invoices (
                user_id, name, client_id, client_name, client_address, client_vat, client_email,
                items, subtotal, vat_amount, total, vat_regime, currency,
                frequency, day_of_period, start_date, end_date,
                max_occurrences, payment_terms, auto_send_email, auto_send_peppol,
                status, next_issue_date, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            RETURNING *
        `, [
            req.user.id,
            name.trim(),
            clientId || null,
            finalClientName || null,
            finalClientAddress || null,
            finalClientVat || null,
            finalClientEmail || null,
            JSON.stringify(totals.items),
            totals.subtotal,
            totals.vatAmount,
            totals.total,
            finalVatRegime,
            currency || 'EUR',
            frequency,
            dayOfPeriod ? parseInt(dayOfPeriod) : null,
            startDate,
            endDate || null,
            maxOccurrences ? parseInt(maxOccurrences) : null,
            paymentTerms ? parseInt(paymentTerms) : (settings.payment_terms || 30),
            autoSendEmail === true,
            autoSendPeppol === true,
            'active',
            nextIssueDate,
            notes || null
        ]);

        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        console.error('Erreur create recurring:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/recurring/:id — Modifier une regle
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const {
        name, clientId, clientName, clientAddress, clientVat, clientEmail,
        items, vatRegime, currency, frequency, dayOfPeriod,
        startDate, endDate, maxOccurrences, paymentTerms,
        autoSendEmail, autoSendPeppol, notes
    } = req.body;

    try {
        // Charger la regle existante
        const existing = await pool.query(
            'SELECT * FROM recurring_invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Regle introuvable.' });
        }

        // Charger settings
        const settingsResult = await pool.query(
            'SELECT vat_regime, vat_rate FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};

        // Recalculer les totaux si items changes
        let finalItems = existing.rows[0].items;
        let finalSubtotal = parseFloat(existing.rows[0].subtotal);
        let finalVatAmount = parseFloat(existing.rows[0].vat_amount);
        let finalTotal = parseFloat(existing.rows[0].total);
        const finalVatRegime = vatRegime || existing.rows[0].vat_regime || settings.vat_regime || 'franchise';

        if (Array.isArray(items) && items.length > 0) {
            const vatRate = parseFloat(settings.vat_rate) || 21;
            const totals = computeRuleTotals(items, finalVatRegime, vatRate);
            finalItems = totals.items;
            finalSubtotal = totals.subtotal;
            finalVatAmount = totals.vatAmount;
            finalTotal = totals.total;
        }

        // Recalculer la prochaine date si la frequence ou startDate a change
        let nextIssueDate = existing.rows[0].next_issue_date;
        if (frequency && frequency !== existing.rows[0].frequency) {
            nextIssueDate = computeNextIssueDate({
                frequency,
                day_of_period: dayOfPeriod ? parseInt(dayOfPeriod) : existing.rows[0].day_of_period,
                start_date: startDate || existing.rows[0].start_date
            }, new Date()).toISOString().slice(0, 10);
        }

        const result = await pool.query(`
            UPDATE recurring_invoices SET
                name = COALESCE($1, name),
                client_id = COALESCE($2, client_id),
                client_name = COALESCE($3, client_name),
                client_address = COALESCE($4, client_address),
                client_vat = COALESCE($5, client_vat),
                client_email = COALESCE($6, client_email),
                items = $7,
                subtotal = $8,
                vat_amount = $9,
                total = $10,
                vat_regime = $11,
                currency = COALESCE($12, currency),
                frequency = COALESCE($13, frequency),
                day_of_period = COALESCE($14, day_of_period),
                start_date = COALESCE($15, start_date),
                end_date = COALESCE($16, end_date),
                max_occurrences = COALESCE($17, max_occurrences),
                payment_terms = COALESCE($18, payment_terms),
                auto_send_email = COALESCE($19, auto_send_email),
                auto_send_peppol = COALESCE($20, auto_send_peppol),
                next_issue_date = $21,
                notes = COALESCE($22, notes),
                updated_at = NOW()
            WHERE id = $23 AND user_id = $24
            RETURNING *
        `, [
            name || null,
            clientId || null,
            clientName || null,
            clientAddress || null,
            clientVat || null,
            clientEmail || null,
            JSON.stringify(finalItems),
            finalSubtotal,
            finalVatAmount,
            finalTotal,
            finalVatRegime,
            currency || null,
            frequency || null,
            dayOfPeriod !== undefined ? (dayOfPeriod ? parseInt(dayOfPeriod) : null) : null,
            startDate || null,
            endDate !== undefined ? endDate : null,
            maxOccurrences !== undefined ? (maxOccurrences ? parseInt(maxOccurrences) : null) : null,
            paymentTerms !== undefined ? (paymentTerms ? parseInt(paymentTerms) : null) : null,
            autoSendEmail !== undefined ? autoSendEmail : null,
            autoSendPeppol !== undefined ? autoSendPeppol : null,
            nextIssueDate,
            notes !== undefined ? notes : null,
            id,
            req.user.id
        ]);

        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        console.error('Erreur update recurring:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/recurring/:id/pause — Mettre en pause
// ============================================================
router.post('/:id/pause', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            "UPDATE recurring_invoices SET status = 'paused', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING id",
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Regle introuvable ou deja en pause.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/recurring/:id/resume — Reprendre
// ============================================================
router.post('/:id/resume', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Si next_issue_date est dans le passe, on le remet a aujourd'hui
        const rule = await pool.query(
            'SELECT * FROM recurring_invoices WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (rule.rows.length === 0) {
            return res.status(404).json({ error: 'Regle introuvable.' });
        }

        const today = new Date().toISOString().slice(0, 10);
        let nextDate = rule.rows[0].next_issue_date;
        if (!nextDate || nextDate < today) {
            nextDate = today;
        }

        await pool.query(
            "UPDATE recurring_invoices SET status = 'active', next_issue_date = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
            [nextDate, id, req.user.id]
        );

        res.json({ success: true, nextIssueDate: nextDate });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/recurring/:id — Supprimer
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM recurring_invoices WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Regle introuvable.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/recurring/process — Traiter les regles dues (manuel)
// ============================================================
router.post('/process', authenticateToken, async (req, res) => {
    try {
        const result = await processDueRecurringInvoices(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Erreur process recurring:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;