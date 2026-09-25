// backend/routes/excel.js
// Routes pour l'export Excel

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const exporter = require('../utils/excel/exporter');

const router = express.Router();

function sendWorkbook(res, workbook, filename) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return workbook.xlsx.write(res).then(() => res.end());
}

async function getCompany(userId) {
    const result = await pool.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
    return result.rows[0] || {};
}

// ============================================================
// GET /api/excel/quotes — Export des devis
// ============================================================
router.get('/quotes', authenticateToken, async (req, res) => {
    try {
        const { from, to, status } = req.query;
        let query = 'SELECT * FROM quotes WHERE user_id = $1';
        const params = [req.user.id];

        if (from) {
            params.push(from);
            query += ' AND issue_date >= $' + params.length;
        }
        if (to) {
            params.push(to);
            query += ' AND issue_date <= $' + params.length;
        }
        if (status) {
            params.push(status);
            query += ' AND status = $' + params.length;
        }
        query += ' ORDER BY issue_date DESC, id DESC';

        const result = await pool.query(query, params);
        const company = await getCompany(req.user.id);
        const workbook = await exporter.exportQuotes(result.rows, company);
        const filename = 'devis-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, workbook, filename);
    } catch (err) {
        console.error('Erreur export excel quotes:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/excel/invoices — Export des factures
// ============================================================
router.get('/invoices', authenticateToken, async (req, res) => {
    try {
        const { from, to, status } = req.query;
        let query = 'SELECT * FROM invoices WHERE user_id = $1';
        const params = [req.user.id];

        if (from) {
            params.push(from);
            query += ' AND issue_date >= $' + params.length;
        }
        if (to) {
            params.push(to);
            query += ' AND issue_date <= $' + params.length;
        }
        if (status) {
            params.push(status);
            query += ' AND status = $' + params.length;
        }
        query += ' ORDER BY issue_date DESC, id DESC';

        const result = await pool.query(query, params);
        const company = await getCompany(req.user.id);
        const workbook = await exporter.exportInvoices(result.rows, company);
        const filename = 'factures-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, workbook, filename);
    } catch (err) {
        console.error('Erreur export excel invoices:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/excel/clients — Export des clients
// ============================================================
router.get('/clients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM clients WHERE user_id = $1 ORDER BY name ASC',
            [req.user.id]
        );
        const company = await getCompany(req.user.id);
        const workbook = await exporter.exportClients(result.rows, company);
        const filename = 'clients-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, workbook, filename);
    } catch (err) {
        console.error('Erreur export excel clients:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/excel/products — Export des produits
// ============================================================
router.get('/products', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM products WHERE user_id = $1 ORDER BY name ASC',
            [req.user.id]
        );
        const company = await getCompany(req.user.id);
        const workbook = await exporter.exportProducts(result.rows, company);
        const filename = 'produits-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, workbook, filename);
    } catch (err) {
        console.error('Erreur export excel products:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/excel/chantiers — Export des chantiers
// ============================================================
router.get('/chantiers', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*,
                (SELECT COUNT(*) FROM quotes q WHERE q.chantier_id = c.id) as quotes_count,
                (SELECT COUNT(*) FROM quotes q WHERE q.chantier_id = c.id AND q.status = 'accepted') as accepted_count,
                (SELECT COALESCE(SUM(total), 0) FROM quotes q WHERE q.chantier_id = c.id AND q.status = 'accepted') as accepted_value
            FROM chantiers c
            WHERE c.user_id = $1
            ORDER BY c.updated_at DESC
        `, [req.user.id]);

        const chantiers = result.rows.map(r => ({
            id: r.id,
            name: r.name,
            reference: r.reference,
            clientName: r.client_name,
            status: r.status,
            startDate: r.start_date,
            endDate: r.end_date,
            budgetEstimate: r.budget_estimate ? parseFloat(r.budget_estimate) : null,
            quotesCount: parseInt(r.quotes_count),
            acceptedCount: parseInt(r.accepted_count),
            acceptedValue: parseFloat(r.accepted_value) || 0
        }));

        const company = await getCompany(req.user.id);
        const workbook = await exporter.exportChantiers(chantiers, company);
        const filename = 'chantiers-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, workbook, filename);
    } catch (err) {
        console.error('Erreur export excel chantiers:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/excel/all — Export complet (multi-feuilles)
// ============================================================
router.get('/all', authenticateToken, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const [quotesRes, invoicesRes, clientsRes, productsRes] = await Promise.all([
            pool.query('SELECT * FROM quotes WHERE user_id = $1 ORDER BY issue_date DESC', [req.user.id]),
            pool.query('SELECT * FROM invoices WHERE user_id = $1 ORDER BY issue_date DESC', [req.user.id]),
            pool.query('SELECT * FROM clients WHERE user_id = $1 ORDER BY name ASC', [req.user.id]),
            pool.query('SELECT * FROM products WHERE user_id = $1 ORDER BY name ASC', [req.user.id])
        ]);

        const company = await getCompany(req.user.id);

        // Creer un workbook avec toutes les feuilles
        const wbQuotes = await exporter.exportQuotes(quotesRes.rows, company);
        const wbInvoices = await exporter.exportInvoices(invoicesRes.rows, company);
        const wbClients = await exporter.exportClients(clientsRes.rows, company);
        const wbProducts = await exporter.exportProducts(productsRes.rows, company);

        // Fusionner les feuilles dans un seul workbook
        const mainWb = new ExcelJS.Workbook();
        mainWb.creator = 'Devis Express Pro';

        // Copier chaque feuille
        const copySheet = (srcWb) => {
            const srcSheet = srcWb.worksheets[0];
            const newSheet = mainWb.addWorksheet(srcSheet.name);
            newSheet.columns = srcSheet.columns.map(c => ({ width: c.width }));
            srcSheet.eachRow((row, rowNum) => {
                const newRow = newSheet.getRow(rowNum);
                row.eachCell({ includeEmpty: true }, (cell, colNum) => {
                    newRow.getCell(colNum).value = cell.value;
                    newRow.getCell(colNum).numFmt = cell.numFmt;
                    newRow.getCell(colNum).font = cell.font;
                    newRow.getCell(colNum).fill = cell.fill;
                    newRow.getCell(colNum).alignment = cell.alignment;
                    newRow.getCell(colNum).border = cell.border;
                });
                newRow.height = row.height;
            });
            // Fusionner les cellules (titre + sous-titre)
            newSheet.mergeCells('A1:F1');
            newSheet.mergeCells('A2:F2');
        };

        copySheet(wbQuotes);
        copySheet(wbInvoices);
        copySheet(wbClients);
        copySheet(wbProducts);

        const filename = 'export-complet-' + new Date().toISOString().slice(0, 10) + '.xlsx';
        await sendWorkbook(res, mainWb, filename);
    } catch (err) {
        console.error('Erreur export excel all:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;