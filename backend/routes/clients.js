// backend/routes/clients.js
// CRUD du carnet clients

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const { clientService } = require('../services/clientService');
//import { authMiddleware } from "../middleware/auth.js";
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// ============================================================
// GET /api/clients — Liste des clients
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM clients WHERE user_id = $1 ORDER BY name ASC',
            [req.user.id]
        );
        res.json(result.rows.map(c => ({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            notes: c.notes,
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/clients — Créer un client
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { name, contactName, email, phone, address, vatNumber, notes } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du client est requis.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO clients (user_id, name, contact_name, email, phone, address, vat_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [req.user.id, name.trim(), contactName || null, email || null, phone || null, address || null, vatNumber || null, notes || null]);

        const c = result.rows[0];
        res.status(201).json({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            notes: c.notes,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// PUT /api/clients/:id — Modifier un client
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const clientId = parseInt(req.params.id);
    if (!clientId) return res.status(400).json({ error: 'ID invalide.' });

    const { name, contactName, email, phone, address, vatNumber, notes } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du client est requis.' });
    }

    try {
        const result = await pool.query(`
            UPDATE clients
            SET name = $1, contact_name = $2, email = $3, phone = $4, address = $5, vat_number = $6, notes = $7, updated_at = NOW()
            WHERE id = $8 AND user_id = $9
            RETURNING *
        `, [name.trim(), contactName || null, email || null, phone || null, address || null, vatNumber || null, notes || null, clientId, req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client non trouvé.' });
        }
        const c = result.rows[0];
        res.json({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            notes: c.notes,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// DELETE /api/clients/:id — Supprimer un client
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const clientId = parseInt(req.params.id);
    if (!clientId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM clients WHERE id = $1 AND user_id = $2 RETURNING id',
            [clientId, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client non trouvé.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});


// route pour assistant v3

//router.use("/clients", authMiddleware);

router.get(
  "/clients",
  asyncHandler(async (req, res) => {
    const list = await clientService.list({
      tenantId: req.user.tenantId,
      search: req.query.search,
    });
    res.json(list);
  })
);

router.get(
  "/clients/:id",
  asyncHandler(async (req, res) => {
    const client = await clientService.get({
      tenantId: req.user.tenantId,
      clientId: req.params.id,
    });
    res.json(client);
  })
);

router.post(
  "/clients",
  asyncHandler(async (req, res) => {
    const client = await clientService.create({
      tenantId: req.user.tenantId,
      data: req.body,
    });
    res.status(201).json(client);
  })
);

router.patch(
  "/clients/:id",
  asyncHandler(async (req, res) => {
    const client = await clientService.update({
      tenantId: req.user.tenantId,
      clientId: req.params.id,
      data: req.body,
    });
    res.json(client);
  })
);

router.delete(
  "/clients/:id",
  asyncHandler(async (req, res) => {
    const result = await clientService.remove({
      tenantId: req.user.tenantId,
      clientId: req.params.id,
    });
    res.json(result);
  })
);

module.exports = router;