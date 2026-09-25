// backend/routes/chantiers.js
// Routes pour la gestion des chantiers

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    logChantierEvent,
    computeChantierStats,
    getChantierTimeline,
    checkChantierAccess
} = require('../utils/chantiers/helpers');

const router = express.Router();

// ============================================================
// GET /api/chantiers — Liste des chantiers
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, clientId, search, limit } = req.query;

        let query = `
            SELECT c.*,
                (SELECT COUNT(*) FROM quotes q WHERE q.chantier_id = c.id) as quotes_count,
                (SELECT COUNT(*) FROM quotes q WHERE q.chantier_id = c.id AND q.status = 'accepted') as accepted_count,
                (SELECT COALESCE(SUM(total), 0) FROM quotes q WHERE q.chantier_id = c.id AND q.status = 'accepted') as accepted_value,
                (SELECT COUNT(*) FROM invoices i WHERE i.chantier_id = c.id) as invoices_count
            FROM chantiers c
            WHERE c.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ` AND c.status = $${params.length}`;
        }
        if (clientId) {
            params.push(parseInt(clientId));
            query += ` AND c.client_id = $${params.length}`;
        }
        if (search) {
            params.push(`%${search.toLowerCase()}%`);
            query += ` AND (LOWER(c.name) LIKE $${params.length} OR LOWER(c.client_name) LIKE $${params.length})`;
        }

        query += ` ORDER BY c.updated_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit) || 100);

        const result = await pool.query(query, params);

        const chantiers = result.rows.map(row => ({
            id: row.id,
            name: row.name,
            reference: row.reference,
            description: row.description,
            clientId: row.client_id,
            clientName: row.client_name,
            clientAddress: row.client_address,
            status: row.status,
            budgetEstimate: row.budget_estimate ? parseFloat(row.budget_estimate) : null,
            budgetFinal: row.budget_final ? parseFloat(row.budget_final) : null,
            startDate: row.start_date,
            endDate: row.end_date,
            completedAt: row.completed_at,
            notes: row.notes,
            color: row.color,
            quotesCount: parseInt(row.quotes_count),
            acceptedCount: parseInt(row.accepted_count),
            acceptedValue: parseFloat(row.accepted_value) || 0,
            invoicesCount: parseInt(row.invoices_count),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        res.json(chantiers);
    } catch (err) {
        console.error('Erreur get chantiers:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id — Détail d'un chantier
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM chantiers WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }
        const row = result.rows[0];

        const [stats, timeline] = await Promise.all([
            computeChantierStats(id),
            getChantierTimeline(id, req.user.id)
        ]);

        res.json({
            id: row.id,
            name: row.name,
            reference: row.reference,
            description: row.description,
            clientId: row.client_id,
            clientName: row.client_name,
            clientAddress: row.client_address,
            status: row.status,
            budgetEstimate: row.budget_estimate ? parseFloat(row.budget_estimate) : null,
            budgetFinal: row.budget_final ? parseFloat(row.budget_final) : null,
            startDate: row.start_date,
            endDate: row.end_date,
            completedAt: row.completed_at,
            notes: row.notes,
            color: row.color,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            stats,
            timeline
        });
    } catch (err) {
        console.error('Erreur get chantier:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers — Créer un chantier
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        name, reference, description,
        clientId, clientName, clientAddress,
        status, budgetEstimate, startDate, endDate,
        notes, color
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du chantier est requis.' });
    }

    try {
        // Récupérer les infos client si clientId fourni
        let finalClientName = clientName;
        let finalClientAddress = clientAddress;
        if (clientId) {
            const clientResult = await pool.query(
                'SELECT name, address FROM clients WHERE id = $1 AND user_id = $2',
                [clientId, req.user.id]
            );
            if (clientResult.rows.length > 0) {
                finalClientName = finalClientName || clientResult.rows[0].name;
                finalClientAddress = finalClientAddress || clientResult.rows[0].address;
            }
        }

        const result = await pool.query(`
            INSERT INTO chantiers (
                user_id, name, reference, description,
                client_id, client_name, client_address,
                status, budget_estimate, start_date, end_date,
                notes, color
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            req.user.id,
            name.trim(),
            reference || null,
            description || null,
            clientId || null,
            finalClientName || null,
            finalClientAddress || null,
            status || 'planned',
            budgetEstimate ? parseFloat(budgetEstimate) : null,
            startDate || null,
            endDate || null,
            notes || null,
            color || '#f97316'
        ]);

        // Log événement
        await logChantierEvent(req.user.id, result.rows[0].id, 'created', {
            name: name.trim()
        });

        res.json({ success: true, chantier: result.rows[0] });
    } catch (err) {
        console.error('Erreur create chantier:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/chantiers/:id — Modifier un chantier
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Charger l'ancien pour détecter les changements
        const oldResult = await pool.query(
            'SELECT * FROM chantiers WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (oldResult.rows.length === 0) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }
        const old = oldResult.rows[0];

        const {
            name, reference, description,
            clientId, clientName, clientAddress,
            status, budgetEstimate, budgetFinal,
            startDate, endDate, notes, color
        } = req.body;

        // Détecter le changement de statut
        const statusChanged = status && status !== old.status;

        const completedAt = status === 'completed' && old.status !== 'completed'
            ? new Date()
            : (status !== 'completed' ? null : old.completed_at);

        const result = await pool.query(`
            UPDATE chantiers SET
                name = COALESCE($1, name),
                reference = COALESCE($2, reference),
                description = COALESCE($3, description),
                client_id = COALESCE($4, client_id),
                client_name = COALESCE($5, client_name),
                client_address = COALESCE($6, client_address),
                status = COALESCE($7, status),
                budget_estimate = COALESCE($8, budget_estimate),
                budget_final = COALESCE($9, budget_final),
                start_date = COALESCE($10, start_date),
                end_date = COALESCE($11, end_date),
                notes = COALESCE($12, notes),
                color = COALESCE($13, color),
                completed_at = $14,
                updated_at = NOW()
            WHERE id = $15 AND user_id = $16
            RETURNING *
        `, [
            name || null,
            reference || null,
            description || null,
            clientId || null,
            clientName || null,
            clientAddress || null,
            status || null,
            budgetEstimate !== undefined ? parseFloat(budgetEstimate) : null,
            budgetFinal !== undefined ? parseFloat(budgetFinal) : null,
            startDate || null,
            endDate || null,
            notes || null,
            color || null,
            completedAt,
            id,
            req.user.id
        ]);

        // Log événements
        if (statusChanged) {
            await logChantierEvent(req.user.id, id, 'status_changed', {
                from: old.status,
                to: status
            });
        }

        res.json({ success: true, chantier: result.rows[0] });
    } catch (err) {
        console.error('Erreur update chantier:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/chantiers/:id — Supprimer un chantier
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Détacher les devis et factures (ne pas supprimer)
        await pool.query('UPDATE quotes SET chantier_id = NULL WHERE chantier_id = $1', [id]);
        await pool.query('UPDATE invoices SET chantier_id = NULL WHERE chantier_id = $1', [id]);

        const result = await pool.query(
            'DELETE FROM chantiers WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur delete chantier:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id/quotes — Devis du chantier
// ============================================================
router.get('/:id/quotes', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        const result = await pool.query(`
            SELECT id, quote_number, issue_date, valid_date, total, status, client_name
            FROM quotes
            WHERE chantier_id = $1
            ORDER BY created_at DESC
        `, [id]);

        res.json(result.rows.map(r => ({
            id: r.id,
            number: r.quote_number,
            issueDate: r.issue_date,
            validDate: r.valid_date,
            total: parseFloat(r.total),
            status: r.status,
            client: r.client_name
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id/invoices — Factures du chantier
// ============================================================
router.get('/:id/invoices', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        const result = await pool.query(`
            SELECT id, invoice_number, invoice_type, issue_date, due_date, total, amount_paid, amount_due, status
            FROM invoices
            WHERE chantier_id = $1
            ORDER BY created_at DESC
        `, [id]);

        res.json(result.rows.map(r => ({
            id: r.id,
            number: r.invoice_number,
            type: r.invoice_type,
            issueDate: r.issue_date,
            dueDate: r.due_date,
            total: parseFloat(r.total),
            amountPaid: parseFloat(r.amount_paid) || 0,
            amountDue: parseFloat(r.amount_due) || parseFloat(r.total),
            status: r.status
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers/:id/attach-quote/:quoteId — Attacher un devis
// ============================================================
router.post('/:id/attach-quote/:quoteId', authenticateToken, async (req, res) => {
    const chantierId = parseInt(req.params.id);
    const quoteId = parseInt(req.params.quoteId);

    try {
        if (!(await checkChantierAccess(chantierId, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        const result = await pool.query(
            'UPDATE quotes SET chantier_id = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [chantierId, quoteId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Devis introuvable.' });
        }

        await logChantierEvent(req.user.id, chantierId, 'quote_added', {
            quoteId,
            quoteNumber: result.rows[0].quote_number
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers/:id/detach-quote/:quoteId — Détacher un devis
// ============================================================
router.post('/:id/detach-quote/:quoteId', authenticateToken, async (req, res) => {
    const chantierId = parseInt(req.params.id);
    const quoteId = parseInt(req.params.quoteId);

    try {
        if (!(await checkChantierAccess(chantierId, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        await pool.query(
            'UPDATE quotes SET chantier_id = NULL WHERE id = $1 AND chantier_id = $2 AND user_id = $3',
            [quoteId, chantierId, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id/events — Timeline du chantier
// ============================================================
router.get('/:id/events', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const timeline = await getChantierTimeline(id, req.user.id);
        res.json(timeline);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuration Multer pour les photos
const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'chantiers');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const uploadPhoto = multer({
    storage: photoStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Format non supporté. Utilisez JPEG, PNG, WEBP ou GIF.'));
    }
});

// ============================================================
// GET /api/chantiers/:id/stats — Statistiques détaillées
// ============================================================
router.get('/:id/stats', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }
        const stats = await computeChantierStats(id);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers/:id/facturer-tout — Facturer tous les devis acceptés
// ============================================================
router.post('/:id/facturer-tout', authenticateToken, async (req, res) => {
    const chantierId = parseInt(req.params.id);
    if (!chantierId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        if (!(await checkChantierAccess(chantierId, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        // Charger le chantier
        const chantierResult = await pool.query(
            'SELECT * FROM chantiers WHERE id = $1',
            [chantierId]
        );
        const chantier = chantierResult.rows[0];

        // Trouver les devis acceptés non facturés
        const quotesResult = await pool.query(`
            SELECT q.* FROM quotes q
            WHERE q.chantier_id = $1
              AND q.user_id = $2
              AND q.status = 'accepted'
              AND NOT EXISTS (
                  SELECT 1 FROM invoices i 
                  WHERE i.quote_id = q.id
              )
        `, [chantierId, req.user.id]);

        if (quotesResult.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Aucun devis accepté à facturer (ou tous déjà facturés).' 
            });
        }

        // Charger les settings pour TVA
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};
        const vatRegime = settings.vat_regime || 'franchise';

        // Fusionner tous les items des devis acceptés
        const allItems = [];
        let totalSubtotal = 0;

        for (const q of quotesResult.rows) {
            const items = Array.isArray(q.items) ? q.items : [];
            for (const item of items) {
                const total = parseFloat(item.total) || 0;
                totalSubtotal += total;
                allItems.push({
                    ref: item.ref || 'EXT',
                    name: item.name,
                    qty: parseFloat(item.qty) || 1,
                    unitPrice: parseFloat(item.unitPrice) || 0,
                    total,
                    sourceQuote: q.quote_number
                });
            }
        }

        const vatRate = parseFloat(settings.vat_rate) || 21;
        const vatAmount = vatRegime === 'assujetti' 
            ? Math.round(totalSubtotal * (vatRate / 100) * 100) / 100 
            : 0;
        const total = Math.round((totalSubtotal + vatAmount) * 100) / 100;

        // Générer un numéro de facture
        const { generateInvoiceNumber } = require('../utils/invoice-helpers');
        const invoiceNumber = await generateInvoiceNumber(req.user.id, 'invoice');

        // Dates
        const issueDate = new Date().toISOString().slice(0, 10);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (parseInt(settings.payment_terms) || 30));

        // Créer la facture
        const insertResult = await pool.query(`
            INSERT INTO invoices (
                user_id, invoice_number, invoice_type, issue_date, due_date,
                subtotal, vat_amount, total, vat_regime, status, items,
                client_id, client_name, client_address, client_vat, client_email,
                chantier_id, amount_due, notes
            )
            VALUES ($1, $2, 'invoice', $3, $4, $5, $6, $7, $8, 'draft', $9,
                    $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `, [
            req.user.id, invoiceNumber, issueDate, dueDate.toISOString().slice(0, 10),
            totalSubtotal, vatAmount, total, vatRegime,
            JSON.stringify(allItems),
            chantier.client_id, chantier.client_name, chantier.client_address,
            null, null,
            chantierId, total,
            `Facturation groupée du chantier "${chantier.name}" (${quotesResult.rows.length} devis)`
        ]);

        // Log événement
        await logChantierEvent(req.user.id, chantierId, 'invoice_created', {
            invoiceId: insertResult.rows[0].id,
            invoiceNumber,
            total,
            quotesCount: quotesResult.rows.length
        });

        res.json({
            success: true,
            invoice: insertResult.rows[0],
            quotesCount: quotesResult.rows.length,
            total
        });
    } catch (err) {
        console.error('Erreur facturer-tout:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers/:id/notes — Mettre à jour les notes
// ============================================================
router.post('/:id/notes', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const { notes } = req.body;

    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        await pool.query(
            'UPDATE chantiers SET notes = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
            [notes || null, id, req.user.id]
        );

        await logChantierEvent(req.user.id, id, 'note_added', {});

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id/photos — Liste des photos
// ============================================================
router.get('/:id/photos', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        const result = await pool.query(`
            SELECT * FROM chantier_photos
            WHERE chantier_id = $1 AND user_id = $2
            ORDER BY uploaded_at DESC
        `, [id, req.user.id]);

        res.json(result.rows.map(p => ({
            id: p.id,
            filename: p.filename,
            originalName: p.original_name,
            mimeType: p.mime_type,
            sizeBytes: p.size_bytes,
            caption: p.caption,
            url: `/uploads/chantiers/${p.filename}`,
            uploadedAt: p.uploaded_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/chantiers/:id/photos — Uploader une photo
// ============================================================
router.post('/:id/photos', authenticateToken, uploadPhoto.single('photo'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });

    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        const result = await pool.query(`
            INSERT INTO chantier_photos 
                (user_id, chantier_id, filename, original_name, mime_type, size_bytes, caption)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            req.user.id, id, req.file.filename,
            req.file.originalname, req.file.mimetype,
            req.file.size, req.body.caption || null
        ]);

        await logChantierEvent(req.user.id, id, 'photo_added', {
            filename: req.file.filename
        });

        res.json({
            success: true,
            photo: {
                id: result.rows[0].id,
                url: `/uploads/chantiers/${result.rows[0].filename}`,
                caption: result.rows[0].caption,
                uploadedAt: result.rows[0].uploaded_at
            }
        });
    } catch (err) {
        console.error('Erreur upload photo:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/chantiers/:id/photos/:photoId — Supprimer une photo
// ============================================================
router.delete('/:id/photos/:photoId', authenticateToken, async (req, res) => {
    const chantierId = parseInt(req.params.id);
    const photoId = parseInt(req.params.photoId);

    try {
        const result = await pool.query(
            'SELECT filename FROM chantier_photos WHERE id = $1 AND chantier_id = $2 AND user_id = $3',
            [photoId, chantierId, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Photo introuvable.' });
        }

        // Supprimer le fichier
        const filePath = path.join(__dirname, '..', 'uploads', 'chantiers', result.rows[0].filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Supprimer de la DB
        await pool.query(
            'DELETE FROM chantier_photos WHERE id = $1 AND user_id = $2',
            [photoId, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/chantiers/:id/all-quotes — Tous les devis (attachés ou non)
// ============================================================
router.get('/:id/all-quotes', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        if (!(await checkChantierAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Chantier introuvable.' });
        }

        // Devis attachés
        const attachedResult = await pool.query(`
            SELECT id, quote_number, issue_date, total, status, client_name
            FROM quotes WHERE chantier_id = $1 ORDER BY created_at DESC
        `, [id]);

        // Devis non attachés (derniers 50)
        const availableResult = await pool.query(`
            SELECT id, quote_number, issue_date, total, status, client_name
            FROM quotes 
            WHERE user_id = $1 AND chantier_id IS NULL
            ORDER BY created_at DESC LIMIT 50
        `, [req.user.id]);

        res.json({
            attached: attachedResult.rows.map(r => ({
                id: r.id, number: r.quote_number, issueDate: r.issue_date,
                total: parseFloat(r.total), status: r.status, client: r.client_name
            })),
            available: availableResult.rows.map(r => ({
                id: r.id, number: r.quote_number, issueDate: r.issue_date,
                total: parseFloat(r.total), status: r.status, client: r.client_name
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;