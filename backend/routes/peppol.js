// backend/routes/peppol.js
// Routes pour l'envoi de factures via Peppol

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generateUBL } = require('../utils/peppol/ubl-generator');
const storecove = require('../utils/peppol/storecove-client');

const router = express.Router();

// ============================================================
// POST /api/peppol/invoices/:id/send — Envoyer une facture via Peppol
// ============================================================
router.post('/invoices/:id/send', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // 1. Charger la facture
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }
        const invoice = invoiceResult.rows[0];

        // 2. Vérifier si déjà envoyée
        if (invoice.peppol_submission_id) {
            return res.status(400).json({ 
                error: 'Cette facture a déjà été envoyée via Peppol.',
                submissionId: invoice.peppol_submission_id
            });
        }

        // 3. Charger les settings (clé API + legal entity)
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        if (settingsResult.rows.length === 0) {
            return res.status(400).json({ error: 'Paramètres entreprise manquants.' });
        }
        const settings = settingsResult.rows[0];

        // 4. Vérifier la configuration Peppol
        if (!settings.peppol_enabled) {
            return res.status(400).json({ 
                error: 'Peppol non activé. Configurez votre clé API et votre Legal Entity ID dans les paramètres.' 
            });
        }
        if (!settings.peppol_api_key) {
            return res.status(400).json({ error: 'Clé API Peppol manquante.' });
        }
        if (!settings.peppol_legal_entity_id) {
            return res.status(400).json({ error: 'Legal Entity ID Peppol manquant.' });
        }

        // 5. Charger le client
        let client = null;
        if (invoice.client_id) {
            const clientResult = await pool.query(
                'SELECT * FROM clients WHERE id = $1',
                [invoice.client_id]
            );
            if (clientResult.rows.length > 0) client = clientResult.rows[0];
        }

        // 6. Vérifier que le client a un numéro de TVA (obligatoire pour Peppol)
        const clientVat = client?.vat_number || invoice.client_vat;
        if (!clientVat) {
            return res.status(400).json({ 
                error: 'Le client doit avoir un numéro de TVA pour recevoir une facture Peppol.' 
            });
        }

        // 7. Générer le XML UBL
        console.log(`📄 Génération UBL pour facture ${invoice.invoice_number}...`);
        const ublXml = await generateUBL(invoice, settings, client);

        // 8. Envoyer à Storecove
        console.log(`📤 Envoi via Storecove...`);
        const receiverId = `iso6523-actorid-upis::${settings.peppol_scheme_id}:${clientVat.replace(/\s/g, '')}`;
        const senderId = `iso6523-actorid-upis::${settings.peppol_scheme_id}:${(settings.tva || '').replace(/\s/g, '')}`;

        const result = await storecove.submitDocument(settings.peppol_api_key, {
            ublXml,
            senderLegalEntityId: settings.peppol_legal_entity_id,
            receiverLegalEntityId: receiverId,
            documentType: 'invoice'
        });

        if (!result.success) {
            // Enregistrer l'erreur
            await pool.query(`
                UPDATE invoices
                SET peppol_error = $1, updated_at = NOW()
                WHERE id = $2
            `, [result.error, invoiceId]);

            return res.status(500).json({ 
                error: `Erreur d'envoi Peppol : ${result.error}` 
            });
        }

        // 9. Enregistrer le succès
        await pool.query(`
            UPDATE invoices
            SET peppol_submission_id = $1,
                peppol_status = $2,
                peppol_sent_at = NOW(),
                peppol_error = NULL,
                status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                updated_at = NOW()
            WHERE id = $3
        `, [result.submissionId, result.status, invoiceId]);

        console.log(`✅ Facture ${invoice.invoice_number} envoyée via Peppol (submission ${result.submissionId})`);

        res.json({
            success: true,
            submissionId: result.submissionId,
            status: result.status,
            message: 'Facture envoyée via Peppol.'
        });
    } catch (err) {
        console.error('Erreur send Peppol:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/peppol/invoices/:id/status — Vérifier le statut
// ============================================================
router.get('/invoices/:id/status', authenticateToken, async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const invoiceResult = await pool.query(
            'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
            [invoiceId, req.user.id]
        );
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Facture introuvable.' });
        }
        const invoice = invoiceResult.rows[0];

        if (!invoice.peppol_submission_id) {
            return res.json({ 
                status: 'not_sent', 
                message: 'Cette facture n\'a pas encore été envoyée via Peppol.' 
            });
        }

        const settingsResult = await pool.query(
            'SELECT peppol_api_key FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const apiKey = settingsResult.rows[0]?.peppol_api_key;

        if (!apiKey) {
            return res.status(400).json({ error: 'Clé API Peppol manquante.' });
        }

        // Récupérer le statut depuis Storecove
        const result = await storecove.getSubmissionStatus(apiKey, invoice.peppol_submission_id);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        // Mettre à jour la DB si livré
        if (result.status === 'delivered' && !invoice.peppol_delivered_at) {
            await pool.query(`
                UPDATE invoices
                SET peppol_status = 'delivered',
                    peppol_delivered_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
            `, [invoiceId]);
        } else if (result.status && result.status !== invoice.peppol_status) {
            await pool.query(`
                UPDATE invoices
                SET peppol_status = $1, updated_at = NOW()
                WHERE id = $2
            `, [result.status, invoiceId]);
        }

        res.json({
            success: true,
            status: result.status,
            deliveredAt: result.deliveredAt,
            error: result.error
        });
    } catch (err) {
        console.error('Erreur status Peppol:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/peppol/verify — Vérifier qu'un client est joignable
// ============================================================
router.post('/verify', authenticateToken, async (req, res) => {
    const { vatNumber } = req.body;
    if (!vatNumber) return res.status(400).json({ error: 'Numéro de TVA requis.' });

    try {
        const settingsResult = await pool.query(
            'SELECT peppol_api_key, peppol_scheme_id FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0];

        if (!settings?.peppol_api_key) {
            return res.status(400).json({ error: 'Clé API Peppol non configurée.' });
        }

        const scheme = settings.peppol_scheme_id || '0208';
        const identifier = `iso6523-actorid-upis::${scheme}:${vatNumber.replace(/\s/g, '')}`;

        const result = await storecove.lookupParticipant(settings.peppol_api_key, identifier);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            success: true,
            exists: result.exists,
            participant: result.participant,
            identifier
        });
    } catch (err) {
        console.error('Erreur verify Peppol:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/peppol/test-connection — Tester la config
// ============================================================
router.post('/test-connection', authenticateToken, async (req, res) => {
    try {
        const settingsResult = await pool.query(
            'SELECT peppol_api_key, peppol_legal_entity_id FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0];

        if (!settings?.peppol_api_key) {
            return res.status(400).json({ error: 'Clé API manquante.' });
        }

        // Test simple : vérifier un participant connu
        const result = await storecove.lookupParticipant(
            settings.peppol_api_key,
            'iso6523-actorid-upis::0208:0762747721' // TVA test belge
        );

        if (result.success) {
            res.json({ success: true, message: 'Connexion Peppol opérationnelle.' });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Impossible de contacter Storecove. Vérifiez votre clé API.' 
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;