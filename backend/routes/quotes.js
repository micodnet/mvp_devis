// Gestion des devis existants : édition, duplication, suppression, statut

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { computeAllVariants, validateVariants, getSelectedVariant } = require('../utils/variants/helpers');

const { devisService } = require('../services/devisService');
//const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

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
            isMultiOption: q.is_multi_option || false,
            variants: q.variants || [],
            selectedVariantIndex: q.selected_variant_index,
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
// PUT /api/quotes/:id — Éditer un devis complet
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Charger l'ANCIEN devis AVANT modification
        const oldResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );
        if (oldResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }
        const oldQuote = oldResult.rows[0];

        const { items, client, vatRegime, vatRate, validDate } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Au moins un article est requis.' });
        }

        // Recalculer les totaux
        let subtotal = 0;
        if (Array.isArray(items)) {
            for (const it of items) {
                subtotal += (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
            }
        }

        //const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
        const vatAmount = vatRegime === 'assujetti' ? subtotal * ((parseFloat(vatRate) || 0) / 100) : 0;
        const total = subtotal + vatAmount;

        await pool.query(`
            UPDATE quotes
            SET items = $1,
                client_name = $2,
                client_address = $3,
                client_vat = $4,
                client_email = $5,
                vat_regime = $6,
                subtotal = $7,
                vat_amount = $8,
                total = $9,
                valid_date = $10,
                updated_at = NOW()
            WHERE id = $11 AND user_id = $12
        `, [
            JSON.stringify(items),
            client?.name || null,
            client?.address || null,
            client?.vat || null,
            client?.email || null,
            vatRegime || 'franchise',
            subtotal,
            vatAmount,
            total,
            validDate || oldQuote.valid_date,
            quoteId,
            req.user.id
        ]);

        // Charger le NOUVEAU devis et analyser les changements
        const newResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1',
            [quoteId]
        );
        const newQuote = newResult.rows[0];

        // Enregistrer les observations en arrière-plan (non bloquant)
        try {
            const { analyzeQuoteChanges } = require('../utils/assistant/observations');
            await analyzeQuoteChanges(req.user.id, oldQuote, newQuote);
        } catch (obsErr) {
            console.warn('Erreur analyse observations:', obsErr.message);
            // Ne pas bloquer la réponse si l'observation échoue
        }

        res.json({ success: true, quote: newQuote });
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

// ============================================================
// POST /api/quotes/:id/variants — Definir les variantes
// ============================================================
router.post('/:id/variants', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { variants } = req.body;

    const validation = validateVariants(variants);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        // Charger le devis et les settings
        const quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const settingsResult = await pool.query(
            'SELECT vat_regime, vat_rate FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};
        const vatRegime = quoteResult.rows[0].vat_regime || settings.vat_regime || 'franchise';
        const vatRate = parseFloat(settings.vat_rate) || 21;

        // Recalculer chaque variante
        const computed = computeAllVariants(variants, vatRegime, vatRate);

        // Mettre a jour le devis
        await pool.query(`
            UPDATE quotes
            SET is_multi_option = TRUE,
                variants = $1,
                subtotal = 0,
                vat_amount = 0,
                total = 0,
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        `, [JSON.stringify(computed), id, req.user.id]);

        res.json({ success: true, variants: computed });
    } catch (err) {
        console.error('Erreur set variants:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/quotes/:id/variants — Recuperer les variantes
// ============================================================
router.get('/:id/variants', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT variants, selected_variant_index, is_multi_option FROM quotes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const row = result.rows[0];
        res.json({
            isMultiOption: row.is_multi_option,
            variants: row.variants || [],
            selectedVariantIndex: row.selected_variant_index
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/quotes/:id/select-variant — Selectionner une variante
// ============================================================
router.post('/:id/select-variant', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { variantIndex } = req.body;

    if (variantIndex === undefined || variantIndex === null || isNaN(parseInt(variantIndex))) {
        return res.status(400).json({ error: 'variantIndex requis.' });
    }

    try {
        const quoteResult = await pool.query(
            'SELECT variants, is_multi_option FROM quotes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (quoteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        const quote = quoteResult.rows[0];
        if (!quote.is_multi_option) {
            return res.status(400).json({ error: 'Ce devis n\'est pas multi-options.' });
        }

        const variants = quote.variants || [];
        const idx = parseInt(variantIndex);
        if (idx < 0 || idx >= variants.length) {
            return res.status(400).json({ error: 'Index de variante invalide.' });
        }

        const selected = variants[idx];

        // Mettre a jour : copier les items de la variante dans le devis principal
        await pool.query(`
            UPDATE quotes
            SET selected_variant_index = $1,
                items = $2,
                subtotal = $3,
                vat_amount = $4,
                total = $5,
                updated_at = NOW()
            WHERE id = $6 AND user_id = $7
        `, [
            idx,
            JSON.stringify(selected.items || []),
            selected.subtotal || 0,
            selected.vatAmount || 0,
            selected.total || 0,
            id,
            req.user.id
        ]);

        res.json({ success: true, selectedVariant: selected });
    } catch (err) {
        console.error('Erreur select variant:', err);
        res.status(500).json({ error: err.message });
    }
});


// route assistant v3

//router.use("/devis", authMiddleware);

router.get(
  "/devis",
  asyncHandler(async (req, res) => {
    const list = await devisService.list({
      tenantId: req.user.tenantId,
      clientName: req.query.clientName,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
    });
    res.json(list);
  })
);

router.get(
  "/devis/:id",
  asyncHandler(async (req, res) => {
    const devis = await devisService.get({
      tenantId: req.user.tenantId,
      devisId: req.params.id,
    });
    res.json(devis);
  })
);

router.post(
  "/devis",
  asyncHandler(async (req, res) => {
    const devis = await devisService.create({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      data: req.body,
    });
    res.status(201).json(devis);
  })
);

router.patch(
  "/devis/:id",
  asyncHandler(async (req, res) => {
    const devis = await devisService.update({
      tenantId: req.user.tenantId,
      devisId: req.params.id,
      data: req.body,
    });
    res.json(devis);
  })
);

router.post(
  "/devis/:id/status",
  asyncHandler(async (req, res) => {
    const devis = await devisService.updateStatus({
      tenantId: req.user.tenantId,
      devisId: req.params.id,
      status: req.body.status,
    });
    res.json(devis);
  })
);

router.delete(
  "/devis/:id",
  asyncHandler(async (req, res) => {
    const result = await devisService.remove({
      tenantId: req.user.tenantId,
      devisId: req.params.id,
    });
    res.json(result);
  })
);

module.exports = router;