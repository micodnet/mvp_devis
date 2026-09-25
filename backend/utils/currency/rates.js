// backend/utils/currency/rates.js
// Gestion des devises et taux de change

const { pool } = require('../../db');

const CURRENCIES = {
    EUR: { symbol: 'EUR', label: 'Euro', position: 'after' },
    USD: { symbol: '$', label: 'Dollar americain', position: 'before' },
    CHF: { symbol: 'CHF', label: 'Franc suisse', position: 'after' },
    GBP: { symbol: 'GBP', label: 'Livre sterling', position: 'before' }
};

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = { data: null, timestamp: 0 };

async function loadRates() {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL_MS) {
        return cache.data;
    }

    const result = await pool.query('SELECT * FROM exchange_rates');
    const rates = {};
    for (const row of result.rows) {
        if (!rates[row.base_currency]) rates[row.base_currency] = {};
        rates[row.base_currency][row.target_currency] = parseFloat(row.rate);
    }

    cache = { data: rates, timestamp: now };
    return rates;
}

async function getRate(from, to) {
    if (!from || !to || from === to) return 1.0;
    const rates = await loadRates();
    if (rates[from] && rates[from][to] !== undefined) {
        return rates[from][to];
    }
    // Fallback via EUR
    if (from !== 'EUR' && to !== 'EUR') {
        const fromToEur = rates[from]?.EUR || 0;
        const eurToTo = rates.EUR?.[to] || 0;
        if (fromToEur > 0 && eurToTo > 0) {
            return fromToEur * eurToTo;
        }
    }
    return 1.0;
}

async function convert(amount, from, to) {
    const rate = await getRate(from, to);
    return Math.round(amount * rate * 100) / 100;
}

function format(amount, currency) {
    const cur = CURRENCIES[currency] || CURRENCIES.EUR;
    const num = parseFloat(amount) || 0;
    const formatted = num.toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    if (cur.position === 'before') {
        return cur.symbol + ' ' + formatted;
    }
    return formatted + ' ' + cur.symbol;
}

async function setRate(base, target, rate) {
    if (!base || !target || base === target) return false;
    const numRate = parseFloat(rate);
    if (isNaN(numRate) || numRate <= 0) return false;

    await pool.query(`
        INSERT INTO exchange_rates (base_currency, target_currency, rate, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (base_currency, target_currency) DO UPDATE SET
            rate = EXCLUDED.rate,
            updated_at = NOW()
    `, [base.toUpperCase(), target.toUpperCase(), numRate]);

    cache = { data: null, timestamp: 0 };
    return true;
}

async function listRates() {
    const result = await pool.query(
        'SELECT base_currency, target_currency, rate, updated_at FROM exchange_rates ORDER BY base_currency, target_currency'
    );
    return result.rows.map(r => ({
        base: r.base_currency,
        target: r.target_currency,
        rate: parseFloat(r.rate),
        updatedAt: r.updated_at
    }));
}

module.exports = {
    CURRENCIES,
    getRate,
    convert,
    format,
    setRate,
    listRates
};