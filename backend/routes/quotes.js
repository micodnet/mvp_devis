// Gestion des devis existants : édition, duplication, suppression, statut

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'refused'];

// ============================================================
// GET /api/quotes/:id — Récupérer un devis complet
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        const q = result.rows[0];
        res.json({
            id: q.id,
            quoteNumber: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            subtotal: parseFloat(q.subtotal) || 0,
            vatAmount: parseFloat(q.vat_amount) || 0,
            total: parseFloat(q.total),
            vatRegime: q.vat_regime,
            status: q.status || 'draft',
            items: q.items,
            clientId: q.client_id,
            clientName: q.client_name,
            clientAddress: q.client_address,
            clientVat: q.client_vat,
            clientEmail: q.client_email,
            signature: {
                method: q.signature_method,
                data: q.signature_data,
                signedAt: q.signature_signed_at,
                signedBy: q.signature_signed_by,
                ip: q.signature_ip
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/quotes/:id/status — Changer le statut
// ============================================================
router.put('/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Statut invalide.' });
    }
    try {
        const result = await pool.query(
            'UPDATE quotes SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, status',
            [status, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        res.json({ success: true, status: result.rows[0].status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/quotes/:id — Éditer un devis complet (items, client, TVA)
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const { items, client, vatRegime, vatRate, validDate } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Au moins un article est requis.' });
    }

    try {
        // Recalculer les totaux
        const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
        const vatAmount = vatRegime === 'assujetti' ? subtotal * ((parseFloat(vatRate) || 0) / 100) : 0;
        const total = subtotal + vatAmount;

        const result = await pool.query(`
            UPDATE quotes
            SET items = $1,
                subtotal = $2,
                vat_amount = $3,
                total = $4,
                vat_regime = $5,
                client_name = $6,
                client_address = $7,
                client_vat = $8,
                client_email = $9,
                valid_date = $10,
                updated_at = NOW()
            WHERE id = $11 AND user_id = $12
            RETURNING *
        `, [
            JSON.stringify(items),
            subtotal,
            vatAmount,
            total,
            vatRegime,
            client?.name || null,
            client?.address || null,
            client?.vat || null,
            client?.email || null,
            validDate || null,
            req.params.id,
            req.user.id
        ]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        const q = result.rows[0];
        res.json({
            success: true,
            quote: {
                id: q.id,
                quoteNumber: q.quote_number,
                issueDate: q.issue_date,
                validDate: q.valid_date,
                subtotal: parseFloat(q.subtotal),
                vatAmount: parseFloat(q.vat_amount),
                total: parseFloat(q.total),
                vatRegime: q.vat_regime,
                status: q.status,
                items: q.items,
                clientName: q.client_name,
                clientAddress: q.client_address,
                clientVat: q.client_vat,
                clientEmail: q.client_email,
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/quotes/:id/duplicate — Dupliquer un devis
// ============================================================
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
    try {
        // Récupérer le devis source
        const sourceResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (sourceResult.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        const src = sourceResult.rows[0];

        // Nouveau numéro de devis (incrémenter le compteur)
        const counterResult = await pool.query(
            'SELECT last_number FROM counters WHERE user_id = $1',
            [req.user.id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await pool.query('UPDATE counters SET last_number = $1 WHERE user_id = $2', [newNumber, req.user.id]);
        } else {
            await pool.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 1)', [req.user.id]);
        }
        const newQuoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

        // Nouvelle date d'émission + validité 30 jours
        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const validDate = validUntil.toISOString().slice(0, 10);

        const insertResult = await pool.query(`
            INSERT INTO quotes (user_id, quote_number, issue_date, valid_date, subtotal, vat_amount, total, vat_regime, status, items, client_id, client_name, client_address, client_vat, client_email)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, $14)
            RETURNING id, quote_number
        `, [
            req.user.id,
            newQuoteNumber,
            issueDate,
            validDate,
            src.subtotal,
            src.vat_amount,
            src.total,
            src.vat_regime,
            src.items,
            src.client_id,
            src.client_name,
            src.client_address,
            src.client_vat,
            src.client_email
        ]);

        res.json({ success: true, id: insertResult.rows[0].id, quoteNumber: insertResult.rows[0].quote_number });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/quotes/:id — Supprimer un devis
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM quotes WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;