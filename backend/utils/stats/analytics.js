// backend/utils/stats/analytics.js
// Calculs de statistiques avancées pour l'utilisateur

const { pool } = require('../../db');

// ------------------------------------------------------------
// Utilitaire : parser une période
// ------------------------------------------------------------
function parsePeriod(from, to) {
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const toDate = to ? new Date(to) : now;
    return {
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10)
    };
}

// ------------------------------------------------------------
// 1. RENTABILITÉ PAR MÉTIER
// ------------------------------------------------------------
async function getProfitabilityByMetier(userId, from, to) {
    const period = parsePeriod(from, to);

    // On analyse les devis et extrait le métier depuis le préfixe [X] dans les items
    const result = await pool.query(`
        SELECT 
            items,
            total,
            subtotal,
            status,
            issue_date
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
    `, [userId, period.from, period.to]);

    const metiers = {};

    for (const row of result.rows) {
        const items = row.items || [];
        for (const item of items) {
            // Détecter le métier depuis le préfixe [X]
            const match = (item.name || '').match(/^\[([^\]]+)\]/);
            const metier = match ? match[1] : 'Autre';

            if (!metiers[metier]) {
                metiers[metier] = {
                    name: metier,
                    quoteCount: 0,
                    totalRevenue: 0,
                    totalHours: 0,
                    itemCount: 0,
                    acceptedRevenue: 0,
                    acceptedHours: 0
                };
            }

            const isLabor = item.ref && item.ref.startsWith('MO-');
            const lineTotal = parseFloat(item.total) || 0;

            metiers[metier].totalRevenue += lineTotal;
            metiers[metier].itemCount++;

            if (isLabor) {
                metiers[metier].totalHours += parseFloat(item.qty) || 0;
                if (row.status === 'accepted') {
                    metiers[metier].acceptedHours += parseFloat(item.qty) || 0;
                }
            }

            if (row.status === 'accepted') {
                metiers[metier].acceptedRevenue += lineTotal;
            }
        }
    }

    // Compter les devis uniques par métier
    for (const row of result.rows) {
        const items = row.items || [];
        const metiersInQuote = new Set();
        for (const item of items) {
            const match = (item.name || '').match(/^\[([^\]]+)\]/);
            if (match) metiersInQuote.add(match[1]);
        }
        for (const m of metiersInQuote) {
            if (metiers[m]) metiers[m].quoteCount++;
        }
    }

    // Calculer les KPI dérivés
    const result_array = Object.values(metiers).map(m => ({
        ...m,
        avgQuoteValue: m.quoteCount > 0 ? Math.round(m.totalRevenue / m.quoteCount * 100) / 100 : 0,
        hourlyRate: m.totalHours > 0 ? Math.round(m.totalRevenue / m.totalHours * 100) / 100 : 0,
        conversionRate: m.quoteCount > 0 ? Math.round((Object.values(metiers).find(x => x.name === m.name)?.acceptedRevenue || 0) / m.totalRevenue * 100) : 0
    }));

    // Trier par chiffre d'affaires décroissant
    result_array.sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
        period,
        metiers: result_array,
        summary: {
            totalMetiers: result_array.length,
            bestMetier: result_array[0]?.name || null,
            totalRevenue: result_array.reduce((s, m) => s + m.totalRevenue, 0),
            totalHours: result_array.reduce((s, m) => s + m.totalHours, 0)
        }
    };
}

// ------------------------------------------------------------
// 2. RENTABILITÉ PAR CLIENT
// ------------------------------------------------------------
async function getProfitabilityByClient(userId, from, to, limit = 20) {
    const period = parsePeriod(from, to);

    const result = await pool.query(`
        SELECT 
            client_id,
            client_name,
            COUNT(*) as quote_count,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted_count,
            COALESCE(SUM(total), 0) as total_revenue,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_revenue,
            AVG(total) as avg_quote_value,
            MAX(issue_date) as last_quote_date,
            MIN(issue_date) as first_quote_date
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
          AND client_name IS NOT NULL
          AND client_name != ''
        GROUP BY client_id, client_name
        ORDER BY total_revenue DESC
        LIMIT $4
    `, [userId, period.from, period.to, limit]);

    const clients = result.rows.map(row => ({
        id: row.client_id,
        name: row.client_name,
        quoteCount: parseInt(row.quote_count),
        acceptedCount: parseInt(row.accepted_count),
        totalRevenue: parseFloat(row.total_revenue),
        acceptedRevenue: parseFloat(row.accepted_revenue),
        avgQuoteValue: parseFloat(row.avg_quote_value) || 0,
        conversionRate: parseInt(row.quote_count) > 0 
            ? Math.round(parseInt(row.accepted_count) / parseInt(row.quote_count) * 100) 
            : 0,
        lastQuoteDate: row.last_quote_date,
        firstQuoteDate: row.first_quote_date,
        isActive: new Date(row.last_quote_date) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    }));

    return {
        period,
        clients,
        summary: {
            totalClients: clients.length,
            activeClients: clients.filter(c => c.isActive).length,
            topClient: clients[0]?.name || null,
            totalRevenue: clients.reduce((s, c) => s + c.totalRevenue, 0)
        }
    };
}

// ------------------------------------------------------------
// 3. TAUX DE CONVERSION
// ------------------------------------------------------------
async function getConversionStats(userId, from, to) {
    const period = parsePeriod(from, to);

    // Global
    const globalResult = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'draft') as draft,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
            COUNT(*) FILTER (WHERE status = 'refused') as refused,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value,
            AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) as avg_days_to_decision
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
    `, [userId, period.from, period.to]);

    const g = globalResult.rows[0];

    // Par mois
    const monthlyResult = await pool.query(`
        SELECT 
            TO_CHAR(issue_date, 'YYYY-MM') as month,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
        GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
        ORDER BY month ASC
    `, [userId, period.from, period.to]);

    const monthly = monthlyResult.rows.map(row => ({
        month: row.month,
        total: parseInt(row.total),
        accepted: parseInt(row.accepted),
        conversionRate: parseInt(row.total) > 0 
            ? Math.round(parseInt(row.accepted) / parseInt(row.total) * 100) 
            : 0,
        acceptedValue: parseFloat(row.accepted_value)
    }));

    return {
        period,
        global: {
            totalQuotes: parseInt(g.total),
            draft: parseInt(g.draft),
            sent: parseInt(g.sent),
            accepted: parseInt(g.accepted),
            refused: parseInt(g.refused),
            totalValue: parseFloat(g.total_value),
            acceptedValue: parseFloat(g.accepted_value),
            conversionRateByCount: parseInt(g.total) > 0 
                ? Math.round(parseInt(g.accepted) / parseInt(g.total) * 100) 
                : 0,
            conversionRateByValue: parseFloat(g.total_value) > 0 
                ? Math.round(parseFloat(g.accepted_value) / parseFloat(g.total_value) * 100) 
                : 0,
            avgDaysToDecision: Math.round(parseFloat(g.avg_days_to_decision) || 0)
        },
        monthly
    };
}

// ------------------------------------------------------------
// 4. PRÉVISIONNEL DE TRÉSORERIE
// ------------------------------------------------------------
async function getTreasuryForecast(userId) {
    const now = new Date();

    // Factures impayées
    const unpaidResult = await pool.query(`
        SELECT 
            i.id,
            i.invoice_number,
            i.client_name,
            i.due_date,
            i.total,
            COALESCE(i.amount_due, i.total) as amount_due,
            i.status,
            CASE 
                WHEN i.due_date < CURRENT_DATE THEN 'overdue'
                WHEN i.due_date <= CURRENT_DATE + INTERVAL '30 days' THEN '30_days'
                WHEN i.due_date <= CURRENT_DATE + INTERVAL '60 days' THEN '60_days'
                WHEN i.due_date <= CURRENT_DATE + INTERVAL '90 days' THEN '90_days'
                ELSE 'later'
            END as bucket
        FROM invoices i
        WHERE i.user_id = $1
          AND i.status IN ('sent', 'partial', 'overdue')
          AND COALESCE(i.amount_due, i.total) > 0.01
        ORDER BY i.due_date ASC
    `, [userId]);

    // Buckets
    const buckets = {
        overdue: { count: 0, amount: 0, invoices: [] },
        '30_days': { count: 0, amount: 0, invoices: [] },
        '60_days': { count: 0, amount: 0, invoices: [] },
        '90_days': { count: 0, amount: 0, invoices: [] },
        later: { count: 0, amount: 0, invoices: [] }
    };

    for (const inv of unpaidResult.rows) {
        const bucket = buckets[inv.bucket];
        if (bucket) {
            bucket.count++;
            bucket.amount += parseFloat(inv.amount_due);
            bucket.invoices.push({
                id: inv.id,
                number: inv.invoice_number,
                client: inv.client_name,
                dueDate: inv.due_date,
                amount: parseFloat(inv.amount_due),
                status: inv.status
            });
        }
    }

    // Arrondir
    for (const key of Object.keys(buckets)) {
        buckets[key].amount = Math.round(buckets[key].amount * 100) / 100;
    }

    // Devis acceptés non encore facturés (revenu potentiel)
    const acceptedNotInvoicedResult = await pool.query(`
        SELECT 
            q.id, q.quote_number, q.client_name, q.total, q.issue_date
        FROM quotes q
        WHERE q.user_id = $1
          AND q.status = 'accepted'
          AND NOT EXISTS (
              SELECT 1 FROM invoices i 
              WHERE i.quote_id = q.id
          )
        ORDER BY q.issue_date ASC
    `, [userId]);

    const acceptedNotInvoiced = acceptedNotInvoicedResult.rows.map(q => ({
        id: q.id,
        number: q.quote_number,
        client: q.client_name,
        total: parseFloat(q.total),
        issueDate: q.issue_date
    }));

    const totalPotential = acceptedNotInvoiced.reduce((s, q) => s + q.total, 0);

    return {
        asOf: now.toISOString(),
        buckets,
        totalPending: Object.values(buckets).reduce((s, b) => s + b.amount, 0),
        totalOverdue: buckets.overdue.amount,
        next30Days: buckets.overdue.amount + buckets['30_days'].amount,
        next60Days: buckets.overdue.amount + buckets['30_days'].amount + buckets['60_days'].amount,
        next90Days: buckets.overdue.amount + buckets['30_days'].amount + buckets['60_days'].amount + buckets['90_days'].amount,
        acceptedNotInvoiced: {
            count: acceptedNotInvoiced.length,
            total: Math.round(totalPotential * 100) / 100,
            quotes: acceptedNotInvoiced
        }
    };
}

// ------------------------------------------------------------
// 5. TOP PRODUITS / SERVICES
// ------------------------------------------------------------
async function getTopProducts(userId, from, to, limit = 15) {
    const period = parsePeriod(from, to);

    const result = await pool.query(`
        SELECT items FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
          AND status IN ('accepted', 'sent')
    `, [userId, period.from, period.to]);

    const products = {};

    for (const row of result.rows) {
        const items = row.items || [];
        for (const item of items) {
            const key = item.name || 'Inconnu';
            if (!products[key]) {
                products[key] = {
                    name: key,
                    ref: item.ref,
                    totalQty: 0,
                    totalRevenue: 0,
                    occurrences: 0,
                    avgUnitPrice: 0,
                    unitPrices: []
                };
            }
            const qty = parseFloat(item.qty) || 0;
            const unitPrice = parseFloat(item.unitPrice) || 0;
            const total = parseFloat(item.total) || 0;

            products[key].totalQty += qty;
            products[key].totalRevenue += total;
            products[key].occurrences++;
            if (unitPrice > 0) products[key].unitPrices.push(unitPrice);
        }
    }

    // Calculer les moyennes
    const list = Object.values(products).map(p => ({
        ...p,
        avgUnitPrice: p.unitPrices.length > 0 
            ? Math.round(p.unitPrices.reduce((s, x) => s + x, 0) / p.unitPrices.length * 100) / 100 
            : 0,
        unitPrices: undefined
    }));

    // Trier par chiffre d'affaires
    list.sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
        period,
        top: list.slice(0, limit)
    };
}

// ------------------------------------------------------------
// 6. ANALYSE TEMPORELLE
// ------------------------------------------------------------
async function getTemporalStats(userId, from, to, groupBy = 'month') {
    const period = parsePeriod(from, to);

    let groupFormat;
    if (groupBy === 'day') groupFormat = 'YYYY-MM-DD';
    else if (groupBy === 'week') groupFormat = 'IYYY-IW';
    else if (groupBy === 'year') groupFormat = 'YYYY';
    else groupFormat = 'YYYY-MM'; // month par défaut

    const result = await pool.query(`
        SELECT 
            TO_CHAR(issue_date, $4) as period,
            COUNT(*) as total_quotes,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted_quotes,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value,
            AVG(total) as avg_quote_value
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
        GROUP BY TO_CHAR(issue_date, $4)
        ORDER BY period ASC
    `, [userId, period.from, period.to, groupFormat]);

    const series = result.rows.map(row => ({
        period: row.period,
        totalQuotes: parseInt(row.total_quotes),
        acceptedQuotes: parseInt(row.accepted_quotes),
        totalValue: parseFloat(row.total_value),
        acceptedValue: parseFloat(row.accepted_value),
        avgQuoteValue: parseFloat(row.avg_quote_value) || 0,
        conversionRate: parseInt(row.total_quotes) > 0 
            ? Math.round(parseInt(row.accepted_quotes) / parseInt(row.total_quotes) * 100) 
            : 0
    }));

    // Comparaison avec la période précédente
    const periodLengthMs = new Date(period.to) - new Date(period.from);
    const previousTo = new Date(new Date(period.from).getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - periodLengthMs);

    const previousResult = await pool.query(`
        SELECT 
            COUNT(*) as total_quotes,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted_quotes,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
    `, [userId, previousFrom.toISOString().slice(0, 10), previousTo.toISOString().slice(0, 10)]);

    const prev = previousResult.rows[0];
    const currentTotal = series.reduce((s, x) => s + x.totalValue, 0);
    const prevTotal = parseFloat(prev.total_value) || 0;
    const growth = prevTotal > 0 ? Math.round((currentTotal - prevTotal) / prevTotal * 100) : 0;

    return {
        period,
        groupBy,
        series,
        comparison: {
            previousPeriod: {
                from: previousFrom.toISOString().slice(0, 10),
                to: previousTo.toISOString().slice(0, 10)
            },
            currentTotalValue: currentTotal,
            previousTotalValue: prevTotal,
            growthPercent: growth,
            currentQuotes: series.reduce((s, x) => s + x.totalQuotes, 0),
            previousQuotes: parseInt(prev.total_quotes) || 0
        }
    };
}

// ------------------------------------------------------------
// 7. KPI DASHBOARD (résumé global)
// ------------------------------------------------------------
async function getKPIDashboard(userId) {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [yearResult, monthResult, last30Result, overdueResult, pipelineResult] = await Promise.all([
        pool.query(`
            SELECT 
                COUNT(*) as quotes,
                COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
                COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as revenue,
                AVG(total) FILTER (WHERE status = 'accepted') as avg_value
            FROM quotes
            WHERE user_id = $1 AND issue_date >= $2
        `, [userId, startOfYear.toISOString().slice(0, 10)]),

        pool.query(`
            SELECT 
                COUNT(*) as quotes,
                COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as revenue
            FROM quotes
            WHERE user_id = $1 AND issue_date >= $2
        `, [userId, startOfMonth.toISOString().slice(0, 10)]),

        pool.query(`
            SELECT 
                COUNT(*) as quotes,
                COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
                COALESCE(SUM(total), 0) as total_value,
                COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
            FROM quotes
            WHERE user_id = $1 AND issue_date >= $2
        `, [userId, startOf30Days.toISOString().slice(0, 10)]),

        pool.query(`
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(amount_due), 0) as amount
            FROM invoices
            WHERE user_id = $1 
              AND status IN ('sent', 'partial', 'overdue')
              AND due_date < CURRENT_DATE
        `, [userId]),

        pool.query(`
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(total), 0) as value
            FROM quotes
            WHERE user_id = $1 
              AND status IN ('draft', 'sent')
        `, [userId])
    ]);

    const year = yearResult.rows[0];
    const month = monthResult.rows[0];
    const last30 = last30Result.rows[0];
    const overdue = overdueResult.rows[0];
    const pipeline = pipelineResult.rows[0];

    return {
        year: {
            quotes: parseInt(year.quotes) || 0,
            accepted: parseInt(year.accepted) || 0,
            revenue: parseFloat(year.revenue) || 0,
            avgQuoteValue: parseFloat(year.avg_value) || 0,
            conversionRate: parseInt(year.quotes) > 0 
                ? Math.round(parseInt(year.accepted) / parseInt(year.quotes) * 100) 
                : 0
        },
        month: {
            quotes: parseInt(month.quotes) || 0,
            revenue: parseFloat(month.revenue) || 0
        },
        last30Days: {
            quotes: parseInt(last30.quotes) || 0,
            accepted: parseInt(last30.accepted) || 0,
            totalValue: parseFloat(last30.total_value) || 0,
            acceptedValue: parseFloat(last30.accepted_value) || 0,
            conversionRate: parseInt(last30.quotes) > 0 
                ? Math.round(parseInt(last30.accepted) / parseInt(last30.quotes) * 100) 
                : 0
        },
        overdue: {
            count: parseInt(overdue.count) || 0,
            amount: parseFloat(overdue.amount) || 0
        },
        pipeline: {
            count: parseInt(pipeline.count) || 0,
            value: parseFloat(pipeline.value) || 0
        },
        generatedAt: now.toISOString()
    };
}

module.exports = {
    getProfitabilityByMetier,
    getProfitabilityByClient,
    getConversionStats,
    getTreasuryForecast,
    getTopProducts,
    getTemporalStats,
    getKPIDashboard
};