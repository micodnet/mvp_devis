// backend/utils/pdf-generator-po.js
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { formatDate } = require('./i18n');

function wrapText(text, font, size, maxWidth) {
    const words = String(text || '').split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) > maxWidth) {
            if (current) lines.push(current);
            current = word;
        } else current = test;
    }
    if (current) lines.push(current);
    return lines;
}

async function generatePurchaseOrderPDF(po, items, company, supplier, lang = 'fr') {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const mL = 40, mR = 40;
    const cW = width - mL - mR;

    const darkBlue = rgb(0.05, 0.12, 0.25);
    const black = rgb(0, 0, 0);
    const darkGray = rgb(0.25, 0.28, 0.33);
    const lightGray = rgb(0.55, 0.58, 0.62);
    const rowAlt = rgb(0.97, 0.98, 0.99);
    const headerBg = rgb(0.93, 0.95, 0.97);
    const white = rgb(1, 1, 1);

    const L = {
        fr: { title: 'BON DE COMMANDE', supplier: 'FOURNISSEUR', from: 'ÉMETTEUR', ref: 'Réf.', name: 'Désignation', qty: 'Qté', pu: 'P.U. HT', total: 'Total HT', subtotal: 'Total HT', vat: 'TVA', totalTTC: 'TOTAL TTC', delivery: 'Livraison souhaitée', notes: 'Notes', generated: 'Bon de commande généré automatiquement' },
        nl: { title: 'BESTELBON', supplier: 'LEVERANCIER', from: 'AFZENDER', ref: 'Ref.', name: 'Omschrijving', qty: 'Aantal', pu: 'Prijs excl.', total: 'Totaal excl.', subtotal: 'Subtotaal excl.', vat: 'BTW', totalTTC: 'TOTAAL incl.', delivery: 'Gewenste levering', notes: 'Notities', generated: 'Bestelbon automatisch gegenereerd' },
        en: { title: 'PURCHASE ORDER', supplier: 'SUPPLIER', from: 'FROM', ref: 'Ref.', name: 'Description', qty: 'Qty', pu: 'Unit price', total: 'Total', subtotal: 'Subtotal', vat: 'VAT', totalTTC: 'TOTAL', delivery: 'Expected delivery', notes: 'Notes', generated: 'Purchase order automatically generated' }
    }[lang] || null;
    const T = L || { title: 'BON DE COMMANDE', supplier: 'FOURNISSEUR', from: 'ÉMETTEUR', ref: 'Réf.', name: 'Désignation', qty: 'Qté', pu: 'P.U. HT', total: 'Total HT', subtotal: 'Total HT', vat: 'TVA', totalTTC: 'TOTAL TTC', delivery: 'Livraison souhaitée', notes: 'Notes', generated: 'Bon de commande généré automatiquement' };

    // Bandeau
    const bannerH = 90;
    page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: darkBlue });

    page.drawText(T.title, { x: mL, y: height - 48, size: 24, font: boldFont, color: white });
    page.drawText(company.companyName || 'Votre Entreprise', { x: mL, y: height - 70, size: 11, font, color: rgb(0.85, 0.9, 1) });

    const poW = boldFont.widthOfTextAtSize(po.poNumber, 16);
    page.drawText(po.poNumber, { x: width - mR - poW, y: height - 48, size: 16, font: boldFont, color: white });

    const issueText = formatDate(lang, po.issueDate);
    const issueW = font.widthOfTextAtSize(issueText, 10);
    page.drawText(issueText, { x: width - mR - issueW, y: height - 70, size: 10, font, color: rgb(0.85, 0.9, 1) });

    // Blocs
    let y = height - bannerH - 30;

    // Émetteur
    page.drawText(T.from, { x: mL, y: y, size: 7, font: boldFont, color: lightGray });
    y -= 14;
    page.drawText(company.companyName || 'Votre Entreprise', { x: mL, y: y, size: 11, font: boldFont, color: black });
    y -= 13;
    if (company.address) wrapText(company.address, font, 9, cW / 2 - 20).forEach(l => { page.drawText(l, { x: mL, y: y, size: 9, font, color: darkGray }); y -= 11; });
    if (company.email) { page.drawText(company.email, { x: mL, y: y, size: 9, font, color: darkGray }); y -= 11; }
    if (company.phone) { page.drawText(`Tél : ${company.phone}`, { x: mL, y: y, size: 9, font, color: darkGray }); y -= 11; }

    // Fournisseur
    let ry = height - bannerH - 30;
    const colRightX = width / 2 + 10;
    page.drawText(T.supplier, { x: colRightX, y: ry, size: 7, font: boldFont, color: lightGray });
    ry -= 14;
    page.drawText(supplier.name || 'Fournisseur', { x: colRightX, y: ry, size: 11, font: boldFont, color: black });
    ry -= 13;
    if (supplier.contactName) { page.drawText(supplier.contactName, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }
    if (supplier.address) wrapText(supplier.address, font, 9, cW / 2 - 20).forEach(l => { page.drawText(l, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; });
    if (supplier.email) { page.drawText(supplier.email, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }
    if (supplier.phone) { page.drawText(`Tél : ${supplier.phone}`, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }

    // Date de livraison souhaitée
    if (po.expectedDate) {
        ry -= 8;
        page.drawText(`${T.delivery} : ${formatDate(lang, po.expectedDate)}`, { x: colRightX, y: ry, size: 10, font: boldFont, color: darkBlue });
    }

    // Tableau
    y = Math.min(y, ry) - 30;

    const colRef = mL;
    const colName = mL + 85;
    const colQty = mL + 340;
    const colPU = mL + 410;
    const colTotal = mL + 490;

    const hH = 26;
    page.drawRectangle({ x: mL, y: y - hH, width: cW, height: hH, color: headerBg });

    page.drawText(T.ref,   { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText(T.name,  { x: colName,    y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText(T.qty,   { x: colQty,     y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText(T.pu,    { x: colPU,      y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText(T.total, { x: colTotal,   y: y - 17, size: 9, font: boldFont, color: darkBlue });

    y -= hH;

    items.forEach((item, idx) => {
        if (idx % 2 === 0) page.drawRectangle({ x: mL, y: y - 24, width: cW, height: 24, color: rowAlt });
        page.drawText(item.product_ref || 'N/R', { x: colRef + 5, y: y - 15, size: 8, font, color: darkGray });

        const maxW = colQty - colName - 10;
        let dn = String(item.product_name || '');
        while (font.widthOfTextAtSize(dn, 9) > maxW && dn.length > 5) dn = dn.slice(0, -2);
        if (dn !== item.product_name) dn += '…';
        page.drawText(dn, { x: colName, y: y - 15, size: 9, font, color: black });

        const qs = String(item.quantity);
        const qw = font.widthOfTextAtSize(qs, 9);
        page.drawText(qs, { x: colQty + 15 - qw / 2, y: y - 15, size: 9, font, color: black });

        const pus = parseFloat(item.unit_price).toFixed(2) + ' €';
        const puw = font.widthOfTextAtSize(pus, 9);
        page.drawText(pus, { x: colPU + 40 - puw, y: y - 15, size: 9, font, color: black });

        const ts = parseFloat(item.total).toFixed(2) + ' €';
        const tw = boldFont.widthOfTextAtSize(ts, 9);
        page.drawText(ts, { x: colTotal + 40 - tw, y: y - 15, size: 9, font: boldFont, color: darkBlue });

        page.drawLine({ start: { x: mL, y: y - 24 }, end: { x: mL + cW, y: y - 24 }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
        y -= 24;
    });

    // Total
    y -= 20;
    const tW = 230;
    const tX = width - mR - tW;
    page.drawRectangle({ x: tX, y: y - 40, width: tW, height: 40, color: darkBlue });
    page.drawText(T.totalTTC, { x: tX + 15, y: y - 25, size: 10, font: boldFont, color: rgb(0.85, 0.9, 1) });
    const totStr = parseFloat(po.total).toFixed(2) + ' €';
    const totW = boldFont.widthOfTextAtSize(totStr, 16);
    page.drawText(totStr, { x: tX + tW - 15 - totW, y: y - 26, size: 16, font: boldFont, color: white });

    // Notes
    y -= 70;
    if (po.notes) {
        page.drawText(T.notes, { x: mL, y: y, size: 8, font: boldFont, color: lightGray });
        y -= 12;
        wrapText(po.notes, font, 9, cW).forEach(l => { page.drawText(l, { x: mL, y: y, size: 9, font, color: darkGray }); y -= 11; });
    }

    // Pied
    page.drawLine({ start: { x: mL, y: 50 }, end: { x: width - mR, y: 50 }, thickness: 0.5, color: rgb(0.85, 0.88, 0.92) });
    page.drawText(T.generated, { x: mL, y: 35, size: 7, font, color: lightGray });

    return await pdfDoc.save();
}

module.exports = { generatePurchaseOrderPDF };