// backend/utils/reports/generator.js
// Generation de rapports PDF

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { pool } = require('../../db');

// Palette de couleurs
const COLORS = {
    dark: rgb(0.043, 0.066, 0.125),      // #0b1120
    darker: rgb(0.086, 0.121, 0.196),    // #161f32
    orange: rgb(0.976, 0.451, 0.086),    // #f97316
    orangeLight: rgb(0.984, 0.573, 0.251), // #fb923c
    blue: rgb(0.231, 0.510, 0.965),      // #3b82f6
    green: rgb(0.133, 0.773, 0.369),     // #22c55e
    red: rgb(0.973, 0.443, 0.443),       // #f87171
    yellow: rgb(0.917, 0.702, 0.031),    // #eab308
    gray: rgb(0.58, 0.64, 0.72),         // #94a3b8
    grayDark: rgb(0.392, 0.455, 0.545),  // #64748b
    lightGray: rgb(0.95, 0.96, 0.97),
    white: rgb(1, 1, 1)
};

// Convertit un montant en chaine avec 2 decimales
function fmtMoney(n) {
    const num = parseFloat(n) || 0;
    return num.toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + ' EUR';
}

function fmtNumber(n) {
    const num = parseFloat(n) || 0;
    return num.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function fmtPercent(n) {
    return Math.round(parseFloat(n) || 0) + ' %';
}

function fmtDate(d) {
    if (!d) return '-';
    try {
        return new Date(d).toLocaleDateString('fr-FR');
    } catch (e) {
        return '-';
    }
}

// ============================================================
// Charge toutes les donnees d'un rapport
// ============================================================
async function loadReportData(userId, periodFrom, periodTo) {
    const from = periodFrom;
    const to = periodTo;

    // Settings entreprise
    const settingsResult = await pool.query(
        'SELECT * FROM settings WHERE user_id = $1',
        [userId]
    );
    const company = settingsResult.rows[0] || {};

    // KPIs devis
    const quotesKpi = await pool.query(`
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'draft') as draft,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
            COUNT(*) FILTER (WHERE status = 'refused') as refused,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value,
            COALESCE(AVG(total), 0) as avg_value
        FROM quotes
        WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
    `, [userId, from, to]);

    // KPIs factures
    const invoicesKpi = await pool.query(`
        SELECT
            COUNT(*) as total,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(amount_paid), 0) as paid_value,
            COALESCE(SUM(amount_due), 0) as due_value
        FROM invoices
        WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
    `, [userId, from, to]);

    // Impayes globaux (hors periode)
    const overdueResult = await pool.query(`
        SELECT
            COUNT(*) as count,
            COALESCE(SUM(amount_due), 0) as total
        FROM invoices
        WHERE user_id = $1
          AND status IN ('sent', 'partial', 'overdue')
          AND due_date < CURRENT_DATE
    `, [userId]);

    // Devis par mois
    const monthlyQuotes = await pool.query(`
        SELECT
            TO_CHAR(issue_date, 'YYYY-MM') as month,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
            COALESCE(SUM(total), 0) as value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
        FROM quotes
        WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
        GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
        ORDER BY month ASC
    `, [userId, from, to]);

    // Top clients
    const topClients = await pool.query(`
        SELECT
            client_name,
            COUNT(*) as quote_count,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted_count,
            COALESCE(SUM(total), 0) as total_value,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_value
        FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
          AND client_name IS NOT NULL
          AND client_name != ''
        GROUP BY client_name
        ORDER BY total_value DESC
        LIMIT 10
    `, [userId, from, to]);

    // Top produits
    const quotesForProducts = await pool.query(`
        SELECT items FROM quotes
        WHERE user_id = $1
          AND issue_date BETWEEN $2 AND $3
          AND status IN ('accepted', 'sent')
    `, [userId, from, to]);

    const productMap = {};
    for (const row of quotesForProducts.rows) {
        const items = row.items || [];
        for (const item of items) {
            const key = item.name || 'Inconnu';
            if (!productMap[key]) {
                productMap[key] = { name: key, qty: 0, total: 0, count: 0 };
            }
            productMap[key].qty += parseFloat(item.qty) || 0;
            productMap[key].total += parseFloat(item.total) || 0;
            productMap[key].count++;
        }
    }
    const topProducts = Object.values(productMap)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    // Rentabilite par metier
    const metierMap = {};
    for (const row of quotesForProducts.rows) {
        const items = row.items || [];
        for (const item of items) {
            const match = (item.name || '').match(/^\[([^\]]+)\]/);
            const metier = match ? match[1] : 'Autre';
            if (!metierMap[metier]) {
                metierMap[metier] = { name: metier, total: 0, count: 0 };
            }
            metierMap[metier].total += parseFloat(item.total) || 0;
            metierMap[metier].count++;
        }
    }
    const byMetier = Object.values(metierMap).sort((a, b) => b.total - a.total);

    // Liste des devis de la periode
    const quotesList = await pool.query(`
        SELECT id, quote_number, issue_date, valid_date, client_name,
               subtotal, vat_amount, total, status, currency
        FROM quotes
        WHERE user_id = $1 AND issue_date BETWEEN $2 AND $3
        ORDER BY issue_date DESC
    `, [userId, from, to]);

    // Tresorerie
    const treasury = await pool.query(`
        SELECT
            COALESCE(SUM(amount_due) FILTER (WHERE due_date < CURRENT_DATE), 0) as overdue,
            COALESCE(SUM(amount_due) FILTER (WHERE due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + INTERVAL '30 days'), 0) as d30,
            COALESCE(SUM(amount_due) FILTER (WHERE due_date > CURRENT_DATE + INTERVAL '30 days' AND due_date <= CURRENT_DATE + INTERVAL '60 days'), 0) as d60,
            COALESCE(SUM(amount_due) FILTER (WHERE due_date > CURRENT_DATE + INTERVAL '60 days'), 0) as later
        FROM invoices
        WHERE user_id = $1
          AND status IN ('sent', 'partial', 'overdue')
    `, [userId]);

    return {
        company,
        period: { from, to },
        quotes: {
            total: parseInt(quotesKpi.rows[0].total),
            draft: parseInt(quotesKpi.rows[0].draft),
            sent: parseInt(quotesKpi.rows[0].sent),
            accepted: parseInt(quotesKpi.rows[0].accepted),
            refused: parseInt(quotesKpi.rows[0].refused),
            totalValue: parseFloat(quotesKpi.rows[0].total_value),
            acceptedValue: parseFloat(quotesKpi.rows[0].accepted_value),
            avgValue: parseFloat(quotesKpi.rows[0].avg_value),
            conversionRate: parseInt(quotesKpi.rows[0].total) > 0
                ? Math.round((parseInt(quotesKpi.rows[0].accepted) / parseInt(quotesKpi.rows[0].total)) * 100)
                : 0
        },
        invoices: {
            total: parseInt(invoicesKpi.rows[0].total),
            totalValue: parseFloat(invoicesKpi.rows[0].total_value),
            paidValue: parseFloat(invoicesKpi.rows[0].paid_value),
            dueValue: parseFloat(invoicesKpi.rows[0].due_value)
        },
        overdue: {
            count: parseInt(overdueResult.rows[0].count),
            total: parseFloat(overdueResult.rows[0].total)
        },
        monthly: monthlyQuotes.rows.map(r => ({
            month: r.month,
            total: parseInt(r.total),
            accepted: parseInt(r.accepted),
            value: parseFloat(r.value),
            acceptedValue: parseFloat(r.accepted_value)
        })),
        topClients: topClients.rows.map(r => ({
            name: r.client_name,
            quoteCount: parseInt(r.quote_count),
            acceptedCount: parseInt(r.accepted_count),
            totalValue: parseFloat(r.total_value),
            acceptedValue: parseFloat(r.accepted_value)
        })),
        topProducts,
        byMetier,
        quotesList: quotesList.rows.map(r => ({
            number: r.quote_number,
            issueDate: r.issue_date,
            validDate: r.valid_date,
            clientName: r.client_name,
            subtotal: parseFloat(r.subtotal),
            vatAmount: parseFloat(r.vat_amount),
            total: parseFloat(r.total),
            status: r.status,
            currency: r.currency || 'EUR'
        })),
        treasury: {
            overdue: parseFloat(treasury.rows[0].overdue),
            d30: parseFloat(treasury.rows[0].d30),
            d60: parseFloat(treasury.rows[0].d60),
            later: parseFloat(treasury.rows[0].later)
        }
    };
}

// ============================================================
// Helpers de dessin
// ============================================================
function drawHeader(page, font, boldFont, company, title, period) {
    const { width, height } = page.getSize();

    // Bandeau sombre
    page.drawRectangle({
        x: 0,
        y: height - 100,
        width: width,
        height: 100,
        color: COLORS.dark
    });

    // Trait orange
    page.drawRectangle({
        x: 0,
        y: height - 104,
        width: width,
        height: 4,
        color: COLORS.orange
    });

    // Nom entreprise
    page.drawText(company.company_name || 'Devis Express Pro', {
        x: 40,
        y: height - 40,
        size: 20,
        font: boldFont,
        color: COLORS.white
    });

    // Adresse entreprise
    if (company.address) {
        page.drawText(company.address, {
            x: 40,
            y: height - 60,
            size: 9,
            font: font,
            color: COLORS.gray
        });
    }

    // Numero TVA
    if (company.tva) {
        page.drawText('TVA : ' + company.tva, {
            x: 40,
            y: height - 74,
            size: 9,
            font: font,
            color: COLORS.gray
        });
    }

    // Titre a droite
    page.drawText(title, {
        x: width - 200,
        y: height - 50,
        size: 16,
        font: boldFont,
        color: COLORS.orange
    });

    page.drawText('Du ' + fmtDate(period.from) + ' au ' + fmtDate(period.to), {
        x: width - 200,
        y: height - 72,
        size: 10,
        font: font,
        color: COLORS.gray
    });

    // Date de generation
    page.drawText('Genere le ' + new Date().toLocaleDateString('fr-FR'), {
        x: width - 200,
        y: height - 86,
        size: 8,
        font: font,
        color: COLORS.grayDark
    });
}

function drawFooter(page, font, pageNum, totalPages) {
    const { width } = page.getSize();
    page.drawText('Rapport genere automatiquement par Devis Express Pro', {
        x: 40,
        y: 30,
        size: 8,
        font: font,
        color: COLORS.grayDark
    });
    page.drawText('Page ' + pageNum + ' / ' + totalPages, {
        x: width - 80,
        y: 30,
        size: 8,
        font: font,
        color: COLORS.grayDark
    });
}

function drawSectionTitle(page, boldFont, text, y) {
    page.drawText(text, {
        x: 40,
        y: y,
        size: 14,
        font: boldFont,
        color: COLORS.dark
    });
    page.drawRectangle({
        x: 40,
        y: y - 4,
        width: 60,
        height: 2,
        color: COLORS.orange
    });
    return y - 20;
}

function drawKpiBox(page, font, boldFont, x, y, width, height, label, value, color) {
    page.drawRectangle({
        x,
        y,
        width,
        height,
        color: COLORS.lightGray,
        borderColor: COLORS.gray,
        borderWidth: 0.5
    });
    page.drawRectangle({
        x,
        y,
        width: 4,
        height,
        color: color || COLORS.orange
    });
    page.drawText(label.toUpperCase(), {
        x: x + 12,
        y: y + height - 16,
        size: 8,
        font: boldFont,
        color: COLORS.grayDark
    });
    page.drawText(value, {
        x: x + 12,
        y: y + height - 42,
        size: 16,
        font: boldFont,
        color: COLORS.dark
    });
}

function drawTableHeader(page, boldFont, x, y, columns) {
    page.drawRectangle({
        x,
        y: y - 4,
        width: columns.reduce((s, c) => s + c.width, 0),
        height: 22,
        color: COLORS.dark
    });
    let cursorX = x + 8;
    for (const col of columns) {
        page.drawText(col.label, {
            x: cursorX,
            y: y + 2,
            size: 9,
            font: boldFont,
            color: COLORS.white
        });
        cursorX += col.width;
    }
    return y - 22;
}

function drawTableRow(page, font, x, y, columns, values, isEven) {
    if (isEven) {
        page.drawRectangle({
            x,
            y: y - 4,
            width: columns.reduce((s, c) => s + c.width, 0),
            height: 18,
            color: rgb(0.97, 0.98, 0.99)
        });
    }
    let cursorX = x + 8;
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const val = values[i] || '';
        const text = String(val).substring(0, 60);
        page.drawText(text, {
            x: cursorX,
            y: y + 1,
            size: 9,
            font: font,
            color: col.color || COLORS.dark
        });
        cursorX += col.width;
    }
    return y - 18;
}

// ============================================================
// Genere le rapport complet
// ============================================================
async function generateReport(userId, periodFrom, periodTo, options = {}) {
    const data = await loadReportData(userId, periodFrom, periodTo);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle('Rapport d\'activite - ' + data.company.company_name);
    pdfDoc.setAuthor(data.company.company_name || 'Devis Express Pro');
    pdfDoc.setCreator('Devis Express Pro');

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page 1 : KPI + evolution
    let page = pdfDoc.addPage([595, 842]);
    let { width, height } = page.getSize();

    drawHeader(page, font, boldFont, data.company, 'RAPPORT D\'ACTIVITE', data.period);

    let y = height - 140;

    // Section KPIs
    y = drawSectionTitle(page, boldFont, 'Resume de la periode', y);

    const boxWidth = (width - 100) / 3;
    const boxHeight = 60;
    const gap = 10;

    drawKpiBox(page, font, boldFont, 40, y - boxHeight, boxWidth, boxHeight,
        'Chiffre d\'affaires', fmtMoney(data.quotes.acceptedValue), COLORS.green);

    drawKpiBox(page, font, boldFont, 40 + boxWidth + gap, y - boxHeight, boxWidth, boxHeight,
        'Devis emis', fmtNumber(data.quotes.total), COLORS.blue);

    drawKpiBox(page, font, boldFont, 40 + 2 * (boxWidth + gap), y - boxHeight, boxWidth, boxHeight,
        'Taux conversion', fmtPercent(data.quotes.conversionRate), COLORS.orange);

    y -= (boxHeight + 20);

    drawKpiBox(page, font, boldFont, 40, y - boxHeight, boxWidth, boxHeight,
        'Devis acceptes', fmtNumber(data.quotes.accepted), COLORS.green);

    drawKpiBox(page, font, boldFont, 40 + boxWidth + gap, y - boxHeight, boxWidth, boxHeight,
        'Panier moyen', fmtMoney(data.quotes.avgValue), COLORS.orange);

    drawKpiBox(page, font, boldFont, 40 + 2 * (boxWidth + gap), y - boxHeight, boxWidth, boxHeight,
        'Facture', fmtMoney(data.invoices.totalValue), COLORS.blue);

    y -= (boxHeight + 30);

    // Section Factures
    y = drawSectionTitle(page, boldFont, 'Facturation', y);

    const facturesBoxWidth = (width - 100) / 3;
    drawKpiBox(page, font, boldFont, 40, y - boxHeight, facturesBoxWidth, boxHeight,
        'Total facture', fmtMoney(data.invoices.totalValue), COLORS.blue);

    drawKpiBox(page, font, boldFont, 40 + facturesBoxWidth + gap, y - boxHeight, facturesBoxWidth, boxHeight,
        'Paye', fmtMoney(data.invoices.paidValue), COLORS.green);

    drawKpiBox(page, font, boldFont, 40 + 2 * (facturesBoxWidth + gap), y - boxHeight, facturesBoxWidth, boxHeight,
        'Reste du', fmtMoney(data.invoices.dueValue), COLORS.yellow);

    y -= (boxHeight + 30);

    // Section impayes
    if (data.overdue.count > 0) {
        y = drawSectionTitle(page, boldFont, 'Impayes en cours', y);

        drawKpiBox(page, font, boldFont, 40, y - boxHeight, (width - 100) / 2, boxHeight,
            'Factures en retard', fmtNumber(data.overdue.count), COLORS.red);

        drawKpiBox(page, font, boldFont, 40 + (width - 100) / 2 + gap, y - boxHeight, (width - 100) / 2, boxHeight,
            'Montant impaye', fmtMoney(data.overdue.total), COLORS.red);

        y -= (boxHeight + 30);
    }

    // Section evolution mensuelle (graphique en barres simple)
    if (data.monthly.length > 0) {
        y = drawSectionTitle(page, boldFont, 'Evolution mensuelle du CA', y);

        const chartHeight = 100;
        const chartWidth = width - 80;
        const chartX = 40;
        const chartY = y - chartHeight;

        // Fond
        page.drawRectangle({
            x: chartX,
            y: chartY,
            width: chartWidth,
            height: chartHeight,
            color: COLORS.lightGray
        });

        // Trouver le max pour l'echelle
        const maxValue = Math.max(...data.monthly.map(m => m.acceptedValue), 1);

        // Dessiner les barres
        const barGap = 10;
        const barWidth = (chartWidth - barGap * (data.monthly.length + 1)) / data.monthly.length;

        for (let i = 0; i < data.monthly.length; i++) {
            const m = data.monthly[i];
            const barHeight = (m.acceptedValue / maxValue) * (chartHeight - 30);
            const barX = chartX + barGap + i * (barWidth + barGap);
            const barY = chartY + 20;

            page.drawRectangle({
                x: barX,
                y: barY,
                width: barWidth,
                height: barHeight,
                color: COLORS.orange
            });

            // Label du mois (3 lettres)
            const monthLabel = m.month.split('-')[1];
            page.drawText(monthLabel, {
                x: barX + barWidth / 2 - 8,
                y: chartY + 5,
                size: 8,
                font: font,
                color: COLORS.grayDark
            });

            // Valeur au-dessus
            if (m.acceptedValue > 0) {
                const valText = Math.round(m.acceptedValue) + '';
                page.drawText(valText, {
                    x: barX + barWidth / 2 - valText.length * 2.5,
                    y: barY + barHeight + 3,
                    size: 7,
                    font: boldFont,
                    color: COLORS.dark
                });
            }
        }

        y -= (chartHeight + 20);
    }

    drawFooter(page, font, 1, 3);

    // Page 2 : Top clients + Top produits
    page = pdfDoc.addPage([595, 842]);
    ({ width, height } = page.getSize());

    drawHeader(page, font, boldFont, data.company, 'RAPPORT D\'ACTIVITE', data.period);
    y = height - 140;

    // Top clients
    y = drawSectionTitle(page, boldFont, 'Top 10 clients', y);

    if (data.topClients.length === 0) {
        page.drawText('Aucune donnee client sur cette periode.', {
            x: 40, y: y - 10, size: 10, font: font, color: COLORS.gray
        });
        y -= 30;
    } else {
        const cols = [
            { label: 'Client', width: 220 },
            { label: 'Devis', width: 60 },
            { label: 'Acceptes', width: 70 },
            { label: 'CA total', width: 100, color: COLORS.dark },
            { label: 'CA accepte', width: 105, color: COLORS.orange }
        ];
        y = drawTableHeader(page, boldFont, 40, y, cols);

        for (let i = 0; i < data.topClients.length; i++) {
            const c = data.topClients[i];
            y = drawTableRow(page, font, 40, y, cols, [
                c.name.substring(0, 35),
                c.quoteCount.toString(),
                c.acceptedCount.toString(),
                fmtMoney(c.totalValue),
                fmtMoney(c.acceptedValue)
            ], i % 2 === 0);
        }
        y -= 20;
    }

    // Top produits
    y = drawSectionTitle(page, boldFont, 'Top 10 produits / services', y);

    if (data.topProducts.length === 0) {
        page.drawText('Aucune donnee produit sur cette periode.', {
            x: 40, y: y - 10, size: 10, font: font, color: COLORS.gray
        });
        y -= 30;
    } else {
        const cols = [
            { label: 'Designation', width: 300 },
            { label: 'Qte', width: 60 },
            { label: 'Occurrences', width: 80 },
            { label: 'Total', width: 115, color: COLORS.orange }
        ];
        y = drawTableHeader(page, boldFont, 40, y, cols);

        for (let i = 0; i < data.topProducts.length; i++) {
            const p = data.topProducts[i];
            y = drawTableRow(page, font, 40, y, cols, [
                p.name.substring(0, 50),
                fmtNumber(p.qty),
                p.count.toString(),
                fmtMoney(p.total)
            ], i % 2 === 0);
        }
    }

    drawFooter(page, font, 2, 3);

    // Page 3 : Rentabilite metier + Tresorerie + Liste devis
    page = pdfDoc.addPage([595, 842]);
    ({ width, height } = page.getSize());

    drawHeader(page, font, boldFont, data.company, 'RAPPORT D\'ACTIVITE', data.period);
    y = height - 140;

    // Rentabilite par metier
    y = drawSectionTitle(page, boldFont, 'Rentabilite par metier', y);

    if (data.byMetier.length === 0) {
        page.drawText('Aucune donnee metier sur cette periode.', {
            x: 40, y: y - 10, size: 10, font: font, color: COLORS.gray
        });
        y -= 30;
    } else {
        const cols = [
            { label: 'Metier', width: 200 },
            { label: 'Lignes', width: 80 },
            { label: 'CA total', width: 235, color: COLORS.orange }
        ];
        y = drawTableHeader(page, boldFont, 40, y, cols);

        for (let i = 0; i < data.byMetier.length; i++) {
            const m = data.byMetier[i];
            y = drawTableRow(page, font, 40, y, cols, [
                m.name.substring(0, 30),
                m.count.toString(),
                fmtMoney(m.total)
            ], i % 2 === 0);
        }
        y -= 20;
    }

    // Tresorerie
    y = drawSectionTitle(page, boldFont, 'Previsionnel de tresorerie', y);

    const tresoBoxWidth = (width - 100) / 4;
    drawKpiBox(page, font, boldFont, 40, y - boxHeight, tresoBoxWidth, boxHeight,
        'En retard', fmtMoney(data.treasury.overdue), COLORS.red);

    drawKpiBox(page, font, boldFont, 40 + tresoBoxWidth + gap, y - boxHeight, tresoBoxWidth, boxHeight,
        '30 jours', fmtMoney(data.treasury.d30), COLORS.orange);

    drawKpiBox(page, font, boldFont, 40 + 2 * (tresoBoxWidth + gap), y - boxHeight, tresoBoxWidth, boxHeight,
        '60 jours', fmtMoney(data.treasury.d60), COLORS.yellow);

    drawKpiBox(page, font, boldFont, 40 + 3 * (tresoBoxWidth + gap), y - boxHeight, tresoBoxWidth, boxHeight,
        'Plus tard', fmtMoney(data.treasury.later), COLORS.blue);

    y -= (boxHeight + 30);

    // Liste des devis
    y = drawSectionTitle(page, boldFont, 'Devis de la periode (' + data.quotesList.length + ')', y);

    const STATUS_LABELS = {
        draft: 'Brouillon',
        sent: 'Envoye',
        accepted: 'Accepte',
        refused: 'Refuse'
    };

    const quoteCols = [
        { label: 'Numero', width: 130 },
        { label: 'Date', width: 60 },
        { label: 'Client', width: 150 },
        { label: 'Total', width: 90, color: COLORS.orange },
        { label: 'Statut', width: 85 }
    ];

    // Si la liste est trop longue, on limite
    const maxQuotes = 20;
    const shownQuotes = data.quotesList.slice(0, maxQuotes);

    y = drawTableHeader(page, boldFont, 40, y, quoteCols);

    for (let i = 0; i < shownQuotes.length; i++) {
        const q = shownQuotes[i];
        y = drawTableRow(page, font, 40, y, quoteCols, [
            q.number,
            fmtDate(q.issueDate),
            (q.clientName || '-').substring(0, 25),
            fmtMoney(q.total),
            STATUS_LABELS[q.status] || q.status
        ], i % 2 === 0);

        // Nouvelle page si necessaire
        if (y < 100) {
            drawFooter(page, font, 3, 3);
            page = pdfDoc.addPage([595, 842]);
            ({ width, height } = page.getSize());
            drawHeader(page, font, boldFont, data.company, 'RAPPORT D\'ACTIVITE', data.period);
            y = height - 140;
            y = drawSectionTitle(page, boldFont, 'Devis de la periode (suite)', y);
            y = drawTableHeader(page, boldFont, 40, y, quoteCols);
        }
    }

    if (data.quotesList.length > maxQuotes) {
        y -= 10;
        page.drawText('... et ' + (data.quotesList.length - maxQuotes) + ' autres devis', {
            x: 40, y, size: 9, font: font, color: COLORS.grayDark
        });
    }

    drawFooter(page, font, 3, 3);

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

module.exports = {
    generateReport,
    loadReportData
};