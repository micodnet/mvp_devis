// backend/routes/subcontractors.js
// Routes pour la gestion des sous-traitants

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    ASSIGNMENT_STATUSES,
    computeSubcontractorStats,
    checkSubcontractorAccess,
    updateAssignmentAutoStatus
} = require('../utils/subcontractors/helpers');

const router = express.Router();

// ============================================================
// GET /api/subcontractors — Liste des sous-traitants
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { search, active, specialty } = req.query;

        let query = `
            SELECT s.*,
                (SELECT COUNT(*) FROM subcontractor_assignments a WHERE a.subcontractor_id = s.id) as assignments_count,
                (SELECT COUNT(*) FROM subcontractor_assignments a WHERE a.subcontractor_id = s.id AND a.status IN ('pending', 'in_progress')) as active_assignments,
                (SELECT COALESCE(SUM(amount), 0) FROM subcontractor_assignments a WHERE a.subcontractor_id = s.id AND a.status = 'paid') as paid_total,
                (SELECT COALESCE(SUM(amount), 0) FROM subcontractor_assignments a WHERE a.subcontractor_id = s.id AND a.status IN ('invoiced', 'completed')) as pending_total
            FROM subcontractors s
            WHERE s.user_id = $1
        `;
        const params = [req.user.id];

        if (active === 'true' || active === 'false') {
            params.push(active === 'true');
            query += ' AND s.active = $' + params.length;
        }
        if (specialty) {
            params.push(specialty);
            query += ' AND s.specialty = $' + params.length;
        }
        if (search) {
            params.push('%' + search.toLowerCase() + '%');
            query += ' AND (LOWER(s.name) LIKE $' + params.length +
                ' OR LOWER(s.company_name) LIKE $' + params.length +
                ' OR LOWER(s.email) LIKE $' + params.length +
                ' OR LOWER(s.specialty) LIKE $' + params.length + ')';
        }

        query += ' ORDER BY s.active DESC, s.name ASC';

        const result = await pool.query(query, params);

        const subcontractors = result.rows.map(row => ({
            id: row.id,
            name: row.name,
            companyName: row.company_name,
            contactName: row.contact_name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            vatNumber: row.vat_number,
            iban: row.iban,
            bic: row.bic,
            specialty: row.specialty,
            hourlyRate: row.hourly_rate ? parseFloat(row.hourly_rate) : null,
            paymentTerms: row.payment_terms,
            notes: row.notes,
            active: row.active,
            assignmentsCount: parseInt(row.assignments_count),
            activeAssignments: parseInt(row.active_assignments),
            paidTotal: parseFloat(row.paid_total),
            pendingTotal: parseFloat(row.pending_total),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        res.json(subcontractors);
    } catch (err) {
        console.error('Erreur list subcontractors:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/subcontractors/:id — Detail d'un sous-traitant
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'SELECT * FROM subcontractors WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sous-traitant introuvable.' });
        }

        const sub = result.rows[0];
        const stats = await computeSubcontractorStats(id, req.user.id);

        res.json({
            id: sub.id,
            name: sub.name,
            companyName: sub.company_name,
            contactName: sub.contact_name,
            email: sub.email,
            phone: sub.phone,
            address: sub.address,
            vatNumber: sub.vat_number,
            iban: sub.iban,
            bic: sub.bic,
            specialty: sub.specialty,
            hourlyRate: sub.hourly_rate ? parseFloat(sub.hourly_rate) : null,
            paymentTerms: sub.payment_terms,
            notes: sub.notes,
            active: sub.active,
            createdAt: sub.created_at,
            stats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/subcontractors — Creer un sous-traitant
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        name, companyName, contactName, email, phone, address,
        vatNumber, iban, bic, specialty, hourlyRate,
        paymentTerms, notes, active
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom est requis.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO subcontractors (
                user_id, name, company_name, contact_name, email, phone, address,
                vat_number, iban, bic, specialty, hourly_rate, payment_terms, notes, active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            req.user.id,
            name.trim(),
            companyName || null,
            contactName || null,
            email || null,
            phone || null,
            address || null,
            vatNumber || null,
            iban || null,
            bic || null,
            specialty || null,
            hourlyRate ? parseFloat(hourlyRate) : null,
            parseInt(paymentTerms) || 30,
            notes || null,
            active !== false
        ]);

        res.json({ success: true, subcontractor: result.rows[0] });
    } catch (err) {
        console.error('Erreur create subcontractor:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/subcontractors/:id — Modifier un sous-traitant
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const {
        name, companyName, contactName, email, phone, address,
        vatNumber, iban, bic, specialty, hourlyRate,
        paymentTerms, notes, active
    } = req.body;

    try {
        const result = await pool.query(`
            UPDATE subcontractors SET
                name = COALESCE($1, name),
                company_name = COALESCE($2, company_name),
                contact_name = COALESCE($3, contact_name),
                email = COALESCE($4, email),
                phone = COALESCE($5, phone),
                address = COALESCE($6, address),
                vat_number = COALESCE($7, vat_number),
                iban = COALESCE($8, iban),
                bic = COALESCE($9, bic),
                specialty = COALESCE($10, specialty),
                hourly_rate = COALESCE($11, hourly_rate),
                payment_terms = COALESCE($12, payment_terms),
                notes = COALESCE($13, notes),
                active = COALESCE($14, active),
                updated_at = NOW()
            WHERE id = $15 AND user_id = $16
            RETURNING *
        `, [
            name || null,
            companyName || null,
            contactName || null,
            email || null,
            phone || null,
            address || null,
            vatNumber || null,
            iban || null,
            bic || null,
            specialty || null,
            hourlyRate !== undefined ? (hourlyRate ? parseFloat(hourlyRate) : null) : null,
            paymentTerms !== undefined ? parseInt(paymentTerms) : null,
            notes || null,
            active !== undefined ? active : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sous-traitant introuvable.' });
        }

        res.json({ success: true, subcontractor: result.rows[0] });
    } catch (err) {
        console.error('Erreur update subcontractor:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/subcontractors/:id — Supprimer un sous-traitant
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM subcontractors WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sous-traitant introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/subcontractors/:id/assignments — Missions d'un sous-traitant
// ============================================================
router.get('/:id/assignments', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        if (!(await checkSubcontractorAccess(id, req.user.id))) {
            return res.status(404).json({ error: 'Sous-traitant introuvable.' });
        }

        const result = await pool.query(`
            SELECT a.*, c.name as chantier_name, q.quote_number as quote_number
            FROM subcontractor_assignments a
            LEFT JOIN chantiers c ON c.id = a.chantier_id
            LEFT JOIN quotes q ON q.id = a.quote_id
            WHERE a.subcontractor_id = $1 AND a.user_id = $2
            ORDER BY a.created_at DESC
        `, [id, req.user.id]);

        res.json(result.rows.map(a => ({
            id: a.id,
            title: a.title,
            description: a.description,
            chantierId: a.chantier_id,
            chantierName: a.chantier_name,
            quoteId: a.quote_id,
            quoteNumber: a.quote_number,
            amount: a.amount ? parseFloat(a.amount) : null,
            hourlyRate: a.hourly_rate ? parseFloat(a.hourly_rate) : null,
            estimatedHours: a.estimated_hours ? parseFloat(a.estimated_hours) : null,
            actualHours: a.actual_hours ? parseFloat(a.actual_hours) : null,
            status: a.status,
            startDate: a.start_date,
            endDate: a.end_date,
            completedAt: a.completed_at,
            invoiceNumber: a.invoice_number,
            invoiceDate: a.invoice_date,
            paidAt: a.paid_at,
            paymentMethod: a.payment_method,
            notes: a.notes,
            createdAt: a.created_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/subcontractors/:id/assignments — Creer une mission
// ============================================================
router.post('/:id/assignments', authenticateToken, async (req, res) => {
    const subcontractorId = parseInt(req.params.id);
    if (!subcontractorId) return res.status(400).json({ error: 'ID invalide.' });

    const {
        title, description, chantierId, quoteId,
        amount, hourlyRate, estimatedHours,
        status, startDate, endDate, notes
    } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Le titre est requis.' });
    }

    try {
        if (!(await checkSubcontractorAccess(subcontractorId, req.user.id))) {
            return res.status(404).json({ error: 'Sous-traitant introuvable.' });
        }

        const result = await pool.query(`
            INSERT INTO subcontractor_assignments (
                user_id, subcontractor_id, chantier_id, quote_id,
                title, description, amount, hourly_rate, estimated_hours,
                status, start_date, end_date, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            req.user.id,
            subcontractorId,
            chantierId ? parseInt(chantierId) : null,
            quoteId ? parseInt(quoteId) : null,
            title.trim(),
            description || null,
            amount ? parseFloat(amount) : null,
            hourlyRate ? parseFloat(hourlyRate) : null,
            estimatedHours ? parseFloat(estimatedHours) : null,
            status || 'pending',
            startDate || null,
            endDate || null,
            notes || null
        ]);

        res.json({ success: true, assignment: result.rows[0] });
    } catch (err) {
        console.error('Erreur create assignment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/subcontractors/assignments/all — Toutes les missions
// ============================================================
router.get('/assignments/all', authenticateToken, async (req, res) => {
    try {
        const { status, subcontractorId, chantierId } = req.query;

        let query = `
            SELECT a.*, s.name as subcontractor_name, s.company_name as subcontractor_company,
                   c.name as chantier_name, q.quote_number as quote_number
            FROM subcontractor_assignments a
            JOIN subcontractors s ON s.id = a.subcontractor_id
            LEFT JOIN chantiers c ON c.id = a.chantier_id
            LEFT JOIN quotes q ON q.id = a.quote_id
            WHERE a.user_id = $1
        `;
        const params = [req.user.id];

        if (status) {
            params.push(status);
            query += ' AND a.status = $' + params.length;
        }
        if (subcontractorId) {
            params.push(parseInt(subcontractorId));
            query += ' AND a.subcontractor_id = $' + params.length;
        }
        if (chantierId) {
            params.push(parseInt(chantierId));
            query += ' AND a.chantier_id = $' + params.length;
        }

        query += ' ORDER BY a.created_at DESC';

        const result = await pool.query(query, params);

        res.json(result.rows.map(a => ({
            id: a.id,
            subcontractorId: a.subcontractor_id,
            subcontractorName: a.subcontractor_name,
            subcontractorCompany: a.subcontractor_company,
            chantierId: a.chantier_id,
            chantierName: a.chantier_name,
            quoteId: a.quote_id,
            quoteNumber: a.quote_number,
            title: a.title,
            description: a.description,
            amount: a.amount ? parseFloat(a.amount) : null,
            hourlyRate: a.hourly_rate ? parseFloat(a.hourly_rate) : null,
            estimatedHours: a.estimated_hours ? parseFloat(a.estimated_hours) : null,
            actualHours: a.actual_hours ? parseFloat(a.actual_hours) : null,
            status: a.status,
            startDate: a.start_date,
            endDate: a.end_date,
            completedAt: a.completed_at,
            invoiceNumber: a.invoice_number,
            invoiceDate: a.invoice_date,
            paidAt: a.paid_at,
            notes: a.notes
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/subcontractors/assignments/:id — Modifier une mission
// ============================================================
router.put('/assignments/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const {
        title, description, chantierId, quoteId,
        amount, hourlyRate, estimatedHours, actualHours,
        status, startDate, endDate, notes
    } = req.body;

    try {
        const result = await pool.query(`
            UPDATE subcontractor_assignments SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                chantier_id = COALESCE($3, chantier_id),
                quote_id = COALESCE($4, quote_id),
                amount = COALESCE($5, amount),
                hourly_rate = COALESCE($6, hourly_rate),
                estimated_hours = COALESCE($7, estimated_hours),
                actual_hours = COALESCE($8, actual_hours),
                status = COALESCE($9, status),
                start_date = COALESCE($10, start_date),
                end_date = COALESCE($11, end_date),
                notes = COALESCE($12, notes),
                updated_at = NOW()
            WHERE id = $13 AND user_id = $14
            RETURNING *
        `, [
            title || null,
            description || null,
            chantierId ? parseInt(chantierId) : null,
            quoteId ? parseInt(quoteId) : null,
            amount !== undefined ? (amount ? parseFloat(amount) : null) : null,
            hourlyRate !== undefined ? (hourlyRate ? parseFloat(hourlyRate) : null) : null,
            estimatedHours !== undefined ? (estimatedHours ? parseFloat(estimatedHours) : null) : null,
            actualHours !== undefined ? (actualHours ? parseFloat(actualHours) : null) : null,
            status || null,
            startDate || null,
            endDate || null,
            notes || null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mission introuvable.' });
        }

        res.json({ success: true, assignment: result.rows[0] });
    } catch (err) {
        console.error('Erreur update assignment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/subcontractors/assignments/:id/complete — Marquer terminee
// ============================================================
router.post('/assignments/:id/complete', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { actualHours } = req.body;

    try {
        const result = await pool.query(`
            UPDATE subcontractor_assignments SET
                completed_at = NOW(),
                status = 'completed',
                actual_hours = COALESCE($1, actual_hours),
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
            RETURNING *
        `, [
            actualHours ? parseFloat(actualHours) : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mission introuvable.' });
        }

        await updateAssignmentAutoStatus(id);

        res.json({ success: true, assignment: result.rows[0] });
    } catch (err) {
        console.error('Erreur complete assignment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/subcontractors/assignments/:id/invoice — Facture recue
// ============================================================
router.post('/assignments/:id/invoice', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { invoiceNumber, invoiceDate, amount } = req.body;

    if (!invoiceNumber) {
        return res.status(400).json({ error: 'Numero de facture requis.' });
    }

    try {
        const result = await pool.query(`
            UPDATE subcontractor_assignments SET
                invoice_number = $1,
                invoice_date = COALESCE($2, CURRENT_DATE),
                amount = COALESCE($3, amount),
                status = 'invoiced',
                updated_at = NOW()
            WHERE id = $4 AND user_id = $5
            RETURNING *
        `, [
            invoiceNumber,
            invoiceDate || null,
            amount ? parseFloat(amount) : null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mission introuvable.' });
        }

        res.json({ success: true, assignment: result.rows[0] });
    } catch (err) {
        console.error('Erreur invoice assignment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/subcontractors/assignments/:id/pay — Marquer payee
// ============================================================
router.post('/assignments/:id/pay', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { paymentMethod } = req.body;

    try {
        const result = await pool.query(`
            UPDATE subcontractor_assignments SET
                paid_at = NOW(),
                payment_method = COALESCE($1, payment_method),
                status = 'paid',
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
            RETURNING *
        `, [
            paymentMethod || null,
            id,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mission introuvable.' });
        }

        res.json({ success: true, assignment: result.rows[0] });
    } catch (err) {
        console.error('Erreur pay assignment:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/subcontractors/stats/summary — Statistiques globales
// ============================================================
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const [subsResult, assignResult] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE active = TRUE) as active
                FROM subcontractors WHERE user_id = $1
            `, [req.user.id]),
            pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'pending') as pending,
                    COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                    COUNT(*) FILTER (WHERE status = 'completed') as completed,
                    COUNT(*) FILTER (WHERE status = 'invoiced') as invoiced,
                    COUNT(*) FILTER (WHERE status = 'paid') as paid,
                    COALESCE(SUM(amount), 0) as total_amount,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_amount,
                    COALESCE(SUM(amount) FILTER (WHERE status IN ('invoiced', 'completed')), 0) as pending_amount
                FROM subcontractor_assignments WHERE user_id = $1
            `, [req.user.id])
        ]);

        const s = subsResult.rows[0];
        const a = assignResult.rows[0];

        res.json({
            subcontractors: {
                total: parseInt(s.total),
                active: parseInt(s.active)
            },
            assignments: {
                total: parseInt(a.total),
                pending: parseInt(a.pending),
                inProgress: parseInt(a.in_progress),
                completed: parseInt(a.completed),
                invoiced: parseInt(a.invoiced),
                paid: parseInt(a.paid),
                totalAmount: parseFloat(a.total_amount),
                paidAmount: parseFloat(a.paid_amount),
                pendingAmount: parseFloat(a.pending_amount)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/subcontractors/assignments/:id — Supprimer une mission
// ============================================================
router.delete('/assignments/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM subcontractor_assignments WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mission introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;