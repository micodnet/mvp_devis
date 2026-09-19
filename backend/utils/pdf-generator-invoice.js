const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function generateInvoicePDF(items, subtotal, vatAmount, total, vatRegime, vatRate, invoiceNumber, issueDate, dueDate, status, notes, company, client) {
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
    const green = rgb(0.13, 0.6, 0.27);
    const red = rgb(0.78, 0.2, 0.2);

    // Bandeau
    const bannerH = 90;
    page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: darkBlue });

    page.drawText('FACTURE', { x: mL, y: height - 48, size: 28, font: boldFont, color: white });
    page.drawText(company.companyName || 'Votre Entreprise', { x: mL, y: height - 70, size: 11, font, color: rgb(0.85, 0.9, 1) });

    const iw = boldFont.widthOfTextAtSize(invoiceNumber, 16);
    page.drawText(invoiceNumber, { x: width - mR - iw, y: height - 48, size: 16, font: boldFont, color: white });

    const issueTxt = `Émise le : ${issueDate}`;
    const issueW = font.widthOfTextAtSize(issueTxt, 10);
    page.drawText(issueTxt, { x: width - mR - issueW, y: height - 66, size: 10, font, color: rgb(0.85, 0.9, 1) });

    const dueTxt = `Échéance : ${dueDate}`;
    const dueW = font.widthOfTextAtSize(dueTxt, 10);
    page.drawText(dueTxt, { x: width - mR - dueW, y: height - 80, size: 10, font: boldFont, color: white });

    // Statut PAYÉ en gros si payé
    if (status === 'paid') {
        page.drawText('PAYÉE', { x: 40, y: height - 130, size: 24, font: boldFont, color: green });
    } else if (status === 'overdue') {
        page.drawText('EN RETARD', { x: 40, y: height - 130, size: 20, font: boldFont, color: red });
    }

    // Blocs Émetteur / Client
    const blockTopY = height - bannerH - 30;
    const colLeftX = mL;
    const colRightX = width / 2 + 10;
    const colWidth = width / 2 - 60;

    let ly = blockTopY;

    if (company.logo) {
        try {
            const b64 = company.logo.replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(b64, 'base64');
            if (buf.length > 0) {
                let img;
                try { img = await pdfDoc.embedPng(buf); } catch { img = await pdfDoc.embedJpg(buf); }
                const d = img.scaleToFit(80, 60);
                page.drawImage(img, { x: colLeftX, y: ly - d.height, width: d.width, height: d.height });
                ly = ly - d.height - 10;
            }
        } catch (e) { /* ignore */ }
    }

    page.drawText('ÉMETTEUR', { x: colLeftX, y: ly, size: 7, font: boldFont, color: lightGray });
    ly -= 14;
    page.drawText(company.companyName || 'Votre Entreprise', { x: colLeftX, y: ly, size: 12, font: boldFont, color: black });
    ly -= 14;
    if (company.address) {
        wrapText(company.address, font, 9, colWidth).forEach(l => { page.drawText(l, { x: colLeftX, y: ly, size: 9, font, color: darkGray }); ly -= 11; });
    }
    const contactParts = [];
    if (company.phone) contactParts.push(`Tél : ${company.phone}`);
    if (company.email) contactParts.push(company.email);
    if (contactParts.length > 0) { page.drawText(contactParts.join(' • '), { x: colLeftX, y: ly, size: 9, font, color: darkGray }); ly -= 11; }
    if (company.siret) { page.drawText(`BCE : ${company.siret}`, { x: colLeftX, y: ly, size: 8, font, color: darkGray }); ly -= 11; }
    if (company.tva && vatRegime === 'assujetti') { page.drawText(`TVA : ${company.tva}`, { x: colLeftX, y: ly, size: 8, font, color: darkGray }); ly -= 11; }

    // Client
    let ry = blockTopY;
    const clientBoxHeight = 110;
    page.drawRectangle({
        x: colRightX - 8, y: ry - clientBoxHeight,
        width: width - mR - colRightX + 8, height: clientBoxHeight,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: rgb(0.85, 0.88, 0.92), borderWidth: 0.5
    });
    ry -= 12;
    page.drawText('CLIENT', { x: colRightX, y: ry, size: 7, font: boldFont, color: lightGray });
    ry -= 14;
    page.drawText(client?.name || '—', { x: colRightX, y: ry, size: 11, font: boldFont, color: black });
    ry -= 14;
    if (client?.address) {
        wrapText(client.address, font, 9, width - mR - colRightX - 10).forEach(l => { page.drawText(l, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; });
    }
    if (client?.vat) { page.drawText(`TVA : ${client.vat}`, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }
    if (client?.email) { page.drawText(client.email, { x: colRightX, y: ry, size: 9, font, color: darkGray }); }

    // Tableau
    let y = Math.min(ly, blockTopY - clientBoxHeight) - 30;

    const colRef = mL;
    const colName = mL + 85;
    const colQty = mL + 290;
    const colPU = mL + 360;
    const colTotal = mL + 445;

    const headerHeight = 26;
    page.drawRectangle({ x: mL, y: y - headerHeight, width: cW, height: headerHeight, color: headerBg });

    page.drawText('Réf.', { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Désignation', { x: colName, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Qté', { x: colQty, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('P.U. HT', { x: colPU, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Total HT', { x: colTotal, y: y - 17, size: 9, font: boldFont, color: darkBlue });

    y -= headerHeight;

    const rowH = 24;
    items.forEach((item, idx) => {
        if (idx % 2 === 0) page.drawRectangle({ x: mL, y: y - rowH, width: cW, height: rowH, color: rowAlt });
        page.drawText(item.ref || 'N/R', { x: colRef + 5, y: y - 15, size: 8, font, color: darkGray });

        const maxNameW = colQty - colName - 10;
        let displayName = String(item.name || '');
        while (font.widthOfTextAtSize(displayName, 9) > maxNameW && displayName.length > 5) displayName = displayName.slice(0, -2);
        if (displayName !== item.name) displayName += '…';
        page.drawText(displayName, { x: colName, y: y - 15, size: 9, font, color: black });

        const qtyStr = String(item.qty);
        const qtyW = font.widthOfTextAtSize(qtyStr, 9);
        page.drawText(qtyStr, { x: colQty + 15 - qtyW / 2, y: y - 15, size: 9, font, color: black });

        const puStr = item.unitPrice.toFixed(2) + ' €';
        const puW = font.widthOfTextAtSize(puStr, 9);
        page.drawText(puStr, { x: colPU + 40 - puW, y: y - 15, size: 9, font, color: black });

        const totStr = item.total.toFixed(2) + ' €';
        const totW = boldFont.widthOfTextAtSize(totStr, 9);
        page.drawText(totStr, { x: colTotal + 70 - totW, y: y - 15, size: 9, font: boldFont, color: darkBlue });

        page.drawLine({ start: { x: mL, y: y - rowH }, end: { x: mL + cW, y: y - rowH }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
        y -= rowH;
    });

    // Totaux
    y -= 20;
    const totalBoxWidth = 230;
    const totalBoxX = width - mR - totalBoxWidth;

    if (vatRegime === 'assujetti') {
        const boxH1 = 22;
        page.drawRectangle({ x: totalBoxX, y: y - boxH1, width: totalBoxWidth, height: boxH1, color: rgb(0.96, 0.97, 0.99) });
        page.drawText('Total HT', { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
        const stStr = subtotal.toFixed(2) + ' €';
        const stW = font.widthOfTextAtSize(stStr, 10);
        page.drawText(stStr, { x: totalBoxX + totalBoxWidth - 15 - stW, y: y - 15, size: 10, font, color: black });
        y -= boxH1;

        const boxH2 = 22;
        page.drawRectangle({ x: totalBoxX, y: y - boxH2, width: totalBoxWidth, height: boxH2, color: rgb(0.96, 0.97, 0.99) });
        page.drawText(`TVA (${vatRate}%)`, { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
        const vtStr = vatAmount.toFixed(2) + ' €';
        const vtW = font.widthOfTextAtSize(vtStr, 10);
        page.drawText(vtStr, { x: totalBoxX + totalBoxWidth - 15 - vtW, y: y - 15, size: 10, font, color: black });
        y -= boxH2;
        y -= 4;
    }

    const boxH3 = 40;
    page.drawRectangle({ x: totalBoxX, y: y - boxH3, width: totalBoxWidth, height: boxH3, color: darkBlue });
    page.drawText(vatRegime === 'assujetti' ? 'TOTAL TTC' : 'TOTAL', {
        x: totalBoxX + 15, y: y - 25, size: 10, font: boldFont, color: rgb(0.85, 0.9, 1)
    });
    const totalStr = total.toFixed(2) + ' €';
    const totalW = boldFont.widthOfTextAtSize(totalStr, 16);
    page.drawText(totalStr, { x: totalBoxX + totalBoxWidth - 15 - totalW, y: y - 26, size: 16, font: boldFont, color: white });

    y -= 70;

    // Coordonnées bancaires
    if (company.iban) {
        page.drawText('COORDONNÉES BANCAIRES', { x: mL, y: y, size: 8, font: boldFont, color: lightGray });
        y -= 14;
        page.drawText(`IBAN : ${company.iban}`, { x: mL, y: y, size: 10, font, color: black });
        y -= 13;
        if (company.bic) { page.drawText(`BIC : ${company.bic}`, { x: mL, y: y, size: 10, font, color: black }); y -= 13; }
        if (company.bank_name) { page.drawText(`Banque : ${company.bank_name}`, { x: mL, y: y, size: 10, font, color: black }); y -= 13; }
        y -= 6;
        page.drawText(`Communication : ${invoiceNumber}`, { x: mL, y: y, size: 10, font: boldFont, color: darkBlue });
        y -= 16;
    }

    // Notes
    if (notes) {
        page.drawText('NOTES', { x: mL, y: y, size: 8, font: boldFont, color: lightGray });
        y -= 12;
        wrapText(notes, font, 9, cW).forEach(l => { page.drawText(l, { x: mL, y: y, size: 9, font, color: darkGray }); y -= 11; });
    }

    // Pied de page
    const footerY = 55;
    page.drawLine({ start: { x: mL, y: footerY + 25 }, end: { x: width - mR, y: footerY + 25 }, thickness: 0.5, color: rgb(0.85, 0.88, 0.92) });

    const legalParts = [];
    if (company.siret) legalParts.push(`BCE : ${company.siret}`);
    if (company.tva && vatRegime === 'assujetti') legalParts.push(`TVA : ${company.tva}`);
    if (legalParts.length > 0) page.drawText(legalParts.join(' • '), { x: mL, y: footerY, size: 8, font, color: darkGray });

    if (vatRegime === 'franchise') {
        page.drawText('Régime particulier de franchise des petites entreprises — TVA non applicable.', {
            x: mL, y: footerY - 14, size: 7, font, color: lightGray
        });
    } else {
        page.drawText('Facture soumise à la TVA belge. Paiement à l\'échéance indiquée.', {
            x: mL, y: footerY - 14, size: 7, font, color: lightGray
        });
    }

    page.drawText('Facture générée automatiquement — Document à conserver 7 ans.', {
        x: mL, y: footerY - 26, size: 7, font, color: lightGray
    });

    return await pdfDoc.save();
}

function wrapText(text, font, size, maxWidth) {
    const words = text.split(' ');
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

module.exports = { generateInvoicePDF };