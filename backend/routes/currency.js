// backend/routes/currency.js
// Routes pour la gestion des devises

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const rates = require('../utils/currency/rates');
const { pool } = require('../db');

const router = express.Router();

// ============================================================
// GET /api/currency/list — Liste des devises supportees
// ============================================================
router.get('/list', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT supported_currencies, default_currency FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const row = result.rows[0] || {};
        const supported = row.supported_currencies || ['EUR'];
        const defaultCurrency = row.default_currency || 'EUR';

        res.json({
            default: defaultCurrency,
            supported: supported,
            available: Object.keys(rates.CURRENCIES).map(code => ({
                code,
                ...rates.CURRENCIES[code]
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/currency/config — Modifier les devises supportees
// ============================================================
router.post('/config', authenticateToken, async (req, res) => {
    const { defaultCurrency, supportedCurrencies } = req.body;

    try {
        const updates = [];
        const params = [req.user.id];
        let idx = 2;

        if (defaultCurrency) {
            if (!rates.CURRENCIES[defaultCurrency]) {
                return res.status(400).json({ error: 'Devise non supportee : ' + defaultCurrency });
            }
            updates.push('default_currency = $' + idx);
            params.push(defaultCurrency);
            idx++;
        }

        if (Array.isArray(supportedCurrencies)) {
            const valid = supportedCurrencies.filter(c => rates.CURRENCIES[c]);
            if (valid.length === 0) {
                return res.status(400).json({ error: 'Aucune devise valide fournie.' });
            }
            if (!valid.includes('EUR')) valid.unshift('EUR');
            updates.push('supported_currencies = $' + idx);
            params.push(JSON.stringify(valid));
            idx++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Rien a modifier.' });
        }

        // Verifier que la ligne existe
        await pool.query(
            'INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        await pool.query(
            'UPDATE settings SET ' + updates.join(', ') + ' WHERE user_id = $1',
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur currency config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/currency/rates — Liste des taux
// ============================================================
router.get('/rates', authenticateToken, async (req, res) => {
    try {
        const list = await rates.listRates();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/currency/rates — Modifier un taux
// ============================================================
router.post('/rates', authenticateToken, async (req, res) => {
    const { base, target, rate } = req.body;
    if (!base || !target || rate === undefined) {
        return res.status(400).json({ error: 'base, target et rate sont requis.' });
    }

    try {
        const ok = await rates.setRate(base, target, rate);
        if (!ok) return res.status(400).json({ error: 'Taux invalide.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/currency/convert — Convertir un montant
// ============================================================
router.post('/convert', authenticateToken, async (req, res) => {
    const { amount, from, to } = req.body;
    if (!amount || !from || !to) {
        return res.status(400).json({ error: 'amount, from et to sont requis.' });
    }

    try {
        const rate = await rates.getRate(from, to);
        const converted = await rates.convert(parseFloat(amount), from, to);
        res.json({
            amount: parseFloat(amount),
            from,
            to,
            rate,
            converted
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;