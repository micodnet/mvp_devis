// backend/utils/excel/exporter.js
// Generation de fichiers Excel (.xlsx)

const ExcelJS = require('exceljs');

// Styles reutilisables
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1120' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
const HEADER_ALIGN = { vertical: 'middle', horizontal: 'left' };
const CELL_ALIGN = { vertical: 'middle', horizontal: 'left' };
const CURRENCY_FORMAT = '#,##0.00 "EUR"';

function styleHeaderRow(row) {
    row.height = 22;
    row.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = HEADER_ALIGN;
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFF97316' } }
        };
    });
}

function addCompanyInfo(sheet, company, title) {
    // Titre
    sheet.mergeCells('A1:F1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = title;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FF0B1120' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(1).height = 28;

    // Sous-titre entreprise
    sheet.mergeCells('A2:F2');
    const subCell = sheet.getCell('A2');
    const companyName = company?.company_name || '';
    const today = new Date().toLocaleDateString('fr-FR');
    subCell.value = companyName + ' - Export du ' + today;
    subCell.font = { size: 10, color: { argb: 'FF64748B' } };
    sheet.getRow(2).height = 18;

    // Ligne vide
    sheet.getRow(3).height = 8;
}

// ============================================================
// EXPORT DEVIS
// ============================================================
async function exportQuotes(quotes, company) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Devis Express Pro';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Devis', {
        views: [{ state: 'frozen', ySplit: 5 }]
    });

    addCompanyInfo(sheet, company, 'Export des devis');

    // En-tetes
    const headers = [
        { header: 'Numero', key: 'number', width: 20 },
        { header: 'Date emission', key: 'issueDate', width: 14 },
        { header: 'Date validite', key: 'validDate', width: 14 },
        { header: 'Client', key: 'client', width: 30 },
        { header: 'Email client', key: 'clientEmail', width: 28 },
        { header: 'Statut', key: 'status', width: 14 },
        { header: 'Total HT', key: 'subtotal', width: 14 },
        { header: 'TVA', key: 'vat', width: 12 },
        { header: 'Total TTC', key: 'total', width: 14 },
        { header: 'Signe le', key: 'signedAt', width: 18 },
        { header: 'Signe par', key: 'signedBy', width: 24 }
    ];

    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h.header;
        sheet.getColumn(i + 1).width = h.width;
    });
    styleHeaderRow(headerRow);

    // Donnees
    const STATUS_LABELS = {
        draft: 'Brouillon',
        sent: 'Envoye',
        accepted: 'Accepte',
        refused: 'Refuse'
    };

    let rowIndex = 6;
    quotes.forEach(q => {
        const row = sheet.getRow(rowIndex);
        row.getCell(1).value = q.quote_number || '';
        row.getCell(2).value = q.issue_date ? new Date(q.issue_date) : '';
        row.getCell(3).value = q.valid_date ? new Date(q.valid_date) : '';
        row.getCell(4).value = q.client_name || '';
        row.getCell(5).value = q.client_email || '';
        row.getCell(6).value = STATUS_LABELS[q.status] || q.status || 'Brouillon';
        row.getCell(7).value = parseFloat(q.subtotal) || 0;
        row.getCell(8).value = parseFloat(q.vat_amount) || 0;
        row.getCell(9).value = parseFloat(q.total) || 0;
        row.getCell(10).value = q.signature_signed_at ? new Date(q.signature_signed_at) : '';
        row.getCell(11).value = q.signature_signed_by || '';

        row.getCell(2).numFmt = 'dd/mm/yyyy';
        row.getCell(3).numFmt = 'dd/mm/yyyy';
        row.getCell(7).numFmt = CURRENCY_FORMAT;
        row.getCell(8).numFmt = CURRENCY_FORMAT;
        row.getCell(9).numFmt = CURRENCY_FORMAT;
        row.getCell(10).numFmt = 'dd/mm/yyyy hh:mm';

        row.eachCell(cell => { cell.alignment = CELL_ALIGN; });
        rowIndex++;
    });

    // Ligne de total
    const totalRow = sheet.getRow(rowIndex + 1);
    totalRow.getCell(6).value = 'TOTAL';
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(7).value = { formula: 'SUM(G6:G' + (rowIndex - 1) + ')' };
    totalRow.getCell(8).value = { formula: 'SUM(H6:H' + (rowIndex - 1) + ')' };
    totalRow.getCell(9).value = { formula: 'SUM(I6:I' + (rowIndex - 1) + ')' };
    totalRow.getCell(7).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(8).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(9).numFmt = CURRENCY_FORMAT;
    totalRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFF97316' } };
    });

    // Filtre auto
    sheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: rowIndex - 1, column: headers.length }
    };

    return workbook;
}

// ============================================================
// EXPORT FACTURES
// ============================================================
async function exportInvoices(invoices, company) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Devis Express Pro';

    const sheet = workbook.addWorksheet('Factures', {
        views: [{ state: 'frozen', ySplit: 5 }]
    });

    addCompanyInfo(sheet, company, 'Export des factures');

    const headers = [
        { header: 'Numero', key: 'number', width: 20 },
        { header: 'Type', key: 'type', width: 14 },
        { header: 'Date emission', key: 'issueDate', width: 14 },
        { header: 'Echeance', key: 'dueDate', width: 14 },
        { header: 'Client', key: 'client', width: 30 },
        { header: 'N TVA client', key: 'clientVat', width: 16 },
        { header: 'Statut', key: 'status', width: 14 },
        { header: 'Total HT', key: 'subtotal', width: 14 },
        { header: 'TVA', key: 'vat', width: 12 },
        { header: 'Total TTC', key: 'total', width: 14 },
        { header: 'Paye', key: 'paid', width: 14 },
        { header: 'Reste du', key: 'due', width: 14 },
        { header: 'Date paiement', key: 'paymentDate', width: 16 },
        { header: 'Mode paiement', key: 'paymentMethod', width: 16 }
    ];

    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
        headerRow.getCell(i + 1).value = h.header;
        sheet.getColumn(i + 1).width = h.width;
    });
    styleHeaderRow(headerRow);

    const TYPE_LABELS = {
        invoice: 'Facture',
        deposit: 'Acompte',
        credit_note: 'Avoir',
        final: 'Solde'
    };

    const STATUS_LABELS = {
        draft: 'Brouillon',
        sent: 'Envoyee',
        paid: 'Payee',
        partial: 'Partielle',
        overdue: 'En retard',
        cancelled: 'Annulee'
    };

    let rowIndex = 6;
    invoices.forEach(inv => {
        const row = sheet.getRow(rowIndex);
        row.getCell(1).value = inv.invoice_number || '';
        row.getCell(2).value = TYPE_LABELS[inv.invoice_type] || 'Facture';
        row.getCell(3).value = inv.issue_date ? new Date(inv.issue_date) : '';
        row.getCell(4).value = inv.due_date ? new Date(inv.due_date) : '';
        row.getCell(5).value = inv.client_name || '';
        row.getCell(6).value = inv.client_vat || '';
        row.getCell(7).value = STATUS_LABELS[inv.status] || inv.status || '';
        row.getCell(8).value = parseFloat(inv.subtotal) || 0;
        row.getCell(9).value = parseFloat(inv.vat_amount) || 0;
        row.getCell(10).value = parseFloat(inv.total) || 0;
        row.getCell(11).value = parseFloat(inv.amount_paid) || 0;
        row.getCell(12).value = parseFloat(inv.amount_due) || parseFloat(inv.total) || 0;
        row.getCell(13).value = inv.payment_date ? new Date(inv.payment_date) : '';
        row.getCell(14).value = inv.payment_method || '';

        row.getCell(3).numFmt = 'dd/mm/yyyy';
        row.getCell(4).numFmt = 'dd/mm/yyyy';
        row.getCell(8).numFmt = CURRENCY_FORMAT;
        row.getCell(9).numFmt = CURRENCY_FORMAT;
        row.getCell(10).numFmt = CURRENCY_FORMAT;
        row.getCell(11).numFmt = CURRENCY_FORMAT;
        row.getCell(12).numFmt = CURRENCY_FORMAT;
        row.getCell(13).numFmt = 'dd/mm/yyyy';

        row.eachCell(cell => { cell.alignment = CELL_ALIGN; });
        rowIndex++;
    });

    const totalRow = sheet.getRow(rowIndex + 1);
    totalRow.getCell(7).value = 'TOTAL';
    totalRow.getCell(7).font = { bold: true };
    totalRow.getCell(8).value = { formula: 'SUM(H6:H' + (rowIndex - 1) + ')' };
    totalRow.getCell(9).value = { formula: 'SUM(I6:I' + (rowIndex - 1) + ')' };
    totalRow.getCell(10).value = { formula: 'SUM(J6:J' + (rowIndex - 1) + ')' };
    totalRow.getCell(11).value = { formula: 'SUM(K6:K' + (rowIndex - 1) + ')' };
    totalRow.getCell(12).value = { formula: 'SUM(L6:L' + (rowIndex - 1) + ')' };
    totalRow.getCell(8).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(9).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(10).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(11).numFmt = CURRENCY_FORMAT;
    totalRow.getCell(12).numFmt = CURRENCY_FORMAT;
    totalRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFF97316' } };
    });

    sheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: rowIndex - 1, column: headers.length }
    };

    return workbook;
}

// ============================================================
// EXPORT CLIENTS
// ============================================================
async function exportClients(clients, company) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Devis Express Pro';

    const sheet = workbook.addWorksheet('Clients');
    addCompanyInfo(sheet, company, 'Export des clients');

    const headers = [
        { header: 'Nom', key: 'name', width: 30 },
        { header: 'Contact', key: 'contact', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Telephone', key: 'phone', width: 18 },
        { header: 'Adresse', key: 'address', width: 40 },
        { header: 'N TVA', key: 'vat', width: 18 },
        { header: 'Notes', key: 'notes', width: 30 },
        { header: 'Date creation', key: 'createdAt', width: 16 }
    ];

    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
        headerRow.getCell(i + 1).value = h.header;
        sheet.getColumn(i + 1).width = h.width;
    });
    styleHeaderRow(headerRow);

    let rowIndex = 6;
    clients.forEach(c => {
        const row = sheet.getRow(rowIndex);
        row.getCell(1).value = c.name || '';
        row.getCell(2).value = c.contact_name || '';
        row.getCell(3).value = c.email || '';
        row.getCell(4).value = c.phone || '';
        row.getCell(5).value = c.address || '';
        row.getCell(6).value = c.vat_number || '';
        row.getCell(7).value = c.notes || '';
        row.getCell(8).value = c.created_at ? new Date(c.created_at) : '';
        row.getCell(8).numFmt = 'dd/mm/yyyy';
        row.eachCell(cell => { cell.alignment = CELL_ALIGN; });
        rowIndex++;
    });

    sheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: rowIndex - 1, column: headers.length }
    };

    return workbook;
}

// ============================================================
// EXPORT PRODUITS
// ============================================================
async function exportProducts(products, company) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Devis Express Pro';

    const sheet = workbook.addWorksheet('Produits');
    addCompanyInfo(sheet, company, 'Export du catalogue produits');

    const headers = [
        { header: 'Reference', key: 'ref', width: 16 },
        { header: 'Nom', key: 'name', width: 40 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Categorie', key: 'category', width: 20 },
        { header: 'Unite', key: 'unit', width: 10 },
        { header: 'Prix HT', key: 'price', width: 14 },
        { header: 'Stock', key: 'stock', width: 12 },
        { header: 'Seuil alerte', key: 'threshold', width: 14 }
    ];

    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
        headerRow.getCell(i + 1).value = h.header;
        sheet.getColumn(i + 1).width = h.width;
    });
    styleHeaderRow(headerRow);

    let rowIndex = 6;
    products.forEach(p => {
        const row = sheet.getRow(rowIndex);
        row.getCell(1).value = p.ref || '';
        row.getCell(2).value = p.name || '';
        row.getCell(3).value = p.description || '';
        row.getCell(4).value = p.category || '';
        row.getCell(5).value = p.unit || '';
        row.getCell(6).value = parseFloat(p.unit_price) || 0;
        row.getCell(7).value = p.track_stock ? (parseFloat(p.stock_quantity) || 0) : '';
        row.getCell(8).value = p.track_stock ? (parseFloat(p.stock_alert_threshold) || 0) : '';
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.eachCell(cell => { cell.alignment = CELL_ALIGN; });
        rowIndex++;
    });

    sheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: rowIndex - 1, column: headers.length }
    };

    return workbook;
}

// ============================================================
// EXPORT CHANTIERS
// ============================================================
async function exportChantiers(chantiers, company) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Devis Express Pro';

    const sheet = workbook.addWorksheet('Chantiers');
    addCompanyInfo(sheet, company, 'Export des chantiers');

    const headers = [
        { header: 'Nom', key: 'name', width: 36 },
        { header: 'Reference', key: 'ref', width: 16 },
        { header: 'Client', key: 'client', width: 30 },
        { header: 'Statut', key: 'status', width: 14 },
        { header: 'Date debut', key: 'startDate', width: 14 },
        { header: 'Date fin', key: 'endDate', width: 14 },
        { header: 'Budget estime', key: 'budget', width: 16 },
        { header: 'Devis total', key: 'quotesCount', width: 12 },
        { header: 'Devis acceptes', key: 'acceptedCount', width: 14 },
        { header: 'CA accepte', key: 'acceptedValue', width: 16 }
    ];

    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
        headerRow.getCell(i + 1).value = h.header;
        sheet.getColumn(i + 1).width = h.width;
    });
    styleHeaderRow(headerRow);

    const STATUS_LABELS = {
        planned: 'Planifie',
        in_progress: 'En cours',
        paused: 'En pause',
        completed: 'Termine',
        cancelled: 'Annule'
    };

    let rowIndex = 6;
    chantiers.forEach(c => {
        const row = sheet.getRow(rowIndex);
        row.getCell(1).value = c.name || '';
        row.getCell(2).value = c.reference || '';
        row.getCell(3).value = c.clientName || '';
        row.getCell(4).value = STATUS_LABELS[c.status] || c.status || '';
        row.getCell(5).value = c.startDate ? new Date(c.startDate) : '';
        row.getCell(6).value = c.endDate ? new Date(c.endDate) : '';
        row.getCell(7).value = c.budgetEstimate || 0;
        row.getCell(8).value = c.quotesCount || 0;
        row.getCell(9).value = c.acceptedCount || 0;
        row.getCell(10).value = c.acceptedValue || 0;
        row.getCell(5).numFmt = 'dd/mm/yyyy';
        row.getCell(6).numFmt = 'dd/mm/yyyy';
        row.getCell(7).numFmt = CURRENCY_FORMAT;
        row.getCell(10).numFmt = CURRENCY_FORMAT;
        row.eachCell(cell => { cell.alignment = CELL_ALIGN; });
        rowIndex++;
    });

    sheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: rowIndex - 1, column: headers.length }
    };

    return workbook;
}

module.exports = {
    exportQuotes,
    exportInvoices,
    exportClients,
    exportProducts,
    exportChantiers
};