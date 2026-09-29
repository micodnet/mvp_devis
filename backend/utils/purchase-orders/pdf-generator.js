// backend/utils/purchase-orders/pdf-generator.js
// Generation du PDF d'un bon de commande

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function formatMoney(n) {
    const num = parseFloat(n) || 0;
    const parts = num.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return intPart + ',' + parts[1] + ' EUR';
}

function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return day + '/' + month + '/' + year;
}

async function generatePurchaseOrderPDF(po, items, company, supplier) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const mL = 40;
    const mR = 40;
    const cW = width - mL - mR;

    const primary = rgb(0.05, 0.12, 0.25);
    const accent = rgb(0.976, 0.451, 0.086);
    const darkGray = rgb(0.25, 0.28, 0.33);
    const lightGray = rgb(0.55, 0.58, 0.62);
    const white = rgb(1, 1, 1);
    const lightBg = rgb(0.96, 0.97, 0.99);

    // Bandeau
    const bannerH = 90;
    page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: primary });
    page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: 4, color: accent });

    page.drawText('BON DE COMMANDE', { x: mL, y: height - 48, size: 24, font: boldFont, color: white });
    page.drawText(company.company_name || 'Votre Entreprise', { x: mL, y: height - 70, size: 11, font, color: rgb(0.85, 0.9, 1) });

    const poW = boldFont.widthOfTextAtSize(po.po_number, 16);
    page.drawText(po.po_number, { x: width - mR - poW, y: height - 48, size: 16, font: boldFont, color: white });

    const dateText = 'Emis le : ' + formatDate(po.order_date);
    const dateW = font.widthOfTextAtSize(dateText, 10);
    page.drawText(dateText, { x: width - mR - dateW, y: height - 70, size: 10, font, color: rgb(0.85, 0.9, 1) });

    // Blocs emetteur / fournisseur
    let ly = height - bannerH - 30;

    if (company.logo) {
        try {
            const b64 = company.logo.replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(b64, 'base64');
            if (buf.length > 0) {
                let img;
                try { img = await pdfDoc.embedPng(buf); } catch (e) { img = await pdfDoc.embedJpg(buf); }
                const d = img.scaleToFit(80, 60);
                page.drawImage(img, { x: mL, y: ly - d.height, width: d.width, height: d.height });
                ly -= (d.height + 10);
            }
        } catch (e) {}
    }

    page.drawText('EMETTEUR', { x: mL, y: ly, size: 7, font: boldFont, color: lightGray });
    ly -= 14;
    page.drawText(company.company_name || 'Votre Entreprise', { x: mL, y: ly, size: 12, font: boldFont, color: primary });
    ly -= 14;
    if (company.address) {
        const addr = company.address.substring(0, 60);
        page.drawText(addr, { x: mL, y: ly, size: 9, font, color: darkGray });
        ly -= 11;
    }
    const contactParts = [];
    if (company.phone) contactParts.push('Tel : ' + company.phone);
    if (company.email) contactParts.push('Email : ' + company.email);
    if (contactParts.length > 0) {
        page.drawText(contactParts.join('   -   '), { x: mL, y: ly, size: 9, font, color: darkGray });
        ly -= 11;
    }
    if (company.tva) {
        page.drawText('TVA : ' + company.tva, { x: mL, y: ly, size: 8, font, color: darkGray });
        ly -= 11;
    }

    // Bloc fournisseur
    const colRightX = width / 2 + 10;
    let ry = height - bannerH - 30;
    page.drawRectangle({
        x: colRightX - 8,
        y: ry - 110,
        width: width - mR - colRightX + 8,
        height: 110,
        color: lightBg,
        borderColor: rgb(0.85, 0.88, 0.92),
        borderWidth: 0.5
    });

    ry -= 12;
    page.drawText('FOURNISSEUR', { x: colRightX, y: ry, size: 7, font: boldFont, color: lightGray });
    ry -= 14;
    page.drawText(po.supplier_name || '-', { x: colRightX, y: ry, size: 11, font: boldFont, color: primary });
    ry -= 14;
    if (po.supplier_address) {
        page.drawText(po.supplier_address.substring(0, 50), { x: colRightX, y: ry, size: 9, font, color: darkGray });
        ry -= 11;
    }
    if (po.supplier_vat) {
        page.drawText('TVA : ' + po.supplier_vat, { x: colRightX, y: ry, size: 9, font, color: darkGray });
        ry -= 11;
    }
    if (po.supplier_email) {
        page.drawText(po.supplier_email, { x: colRightX, y: ry, size: 9, font, color: darkGray });
        ry -= 11;
    }

    // Date de livraison souhaitee
    if (po.expected_date) {
        ry -= 6;
        page.drawText('Livraison souhaitee : ' + formatDate(po.expected_date), {
            x: colRightX, y: ry, size: 9, font: boldFont, color: accent
        });
    }

    // Tableau
    let y = Math.min(ly, ry - 30) - 30;

    const colRef = mL;
    const colName = mL + 85;
    const colQty = mL + 290;
    const colPU = mL + 355;
    const colTotal = mL + 440;

    const headerH = 26;
    page.drawRectangle({ x: mL, y: y - headerH, width: cW, height: headerH, color: lightBg });

    page.drawText('REF.', { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: primary });
    page.drawText('DESIGNATION', { x: colName, y: y - 17, size: 9, font: boldFont, color: primary });
    page.drawText('QTE', { x: colQty, y: y - 17, size: 9, font: boldFont, color: primary });
    page.drawText('P.U. HT', { x: colPU, y: y - 17, size: 9, font: boldFont, color: primary });
    page.drawText('TOTAL HT', { x: colTotal, y: y - 17, size: 9, font: boldFont, color: primary });

    y -= headerH;

    const rowH = 24;
    items.forEach((item, idx) => {
        if (idx % 2 === 0) {
            page.drawRectangle({ x: mL, y: y - rowH, width: cW, height: rowH, color: rgb(0.97, 0.98, 0.99) });
        }

        page.drawText(item.product_ref || 'N/R', { x: colRef + 5, y: y - 15, size: 8, font, color: darkGray });

        const maxNameW = colQty - colName - 10;
        let dn = String(item.product_name || '');
        while (font.widthOfTextAtSize(dn, 9) > maxNameW && dn.length > 5) dn = dn.slice(0, -2);
        if (dn !== item.product_name) dn += '...';
        page.drawText(dn, { x: colName, y: y - 15, size: 9, font, color: primary });

        const qs = String(parseFloat(item.quantity));
        const qw = font.widthOfTextAtSize(qs, 9);
        page.drawText(qs, { x: colQty + 15 - qw / 2, y: y - 15, size: 9, font, color: primary });

        const pus = formatMoney(item.unit_price);
        const puw = font.widthOfTextAtSize(pus, 9);
        page.drawText(pus, { x: colPU + 40 - puw, y: y - 15, size: 9, font, color: primary });

        const ts = formatMoney(item.total);
        const tw = boldFont.widthOfTextAtSize(ts, 9);
        page.drawText(ts, { x: colTotal + 70 - tw, y: y - 15, size: 9, font: boldFont, color: primary });

        page.drawLine({
            start: { x: mL, y: y - rowH },
            end: { x: mL + cW, y: y - rowH },
            thickness: 0.5,
            color: rgb(0.88, 0.9, 0.93)
        });

        y -= rowH;
    });

    // Totaux
    y -= 20;
    const totalBoxW = 230;
    const totalBoxX = width - mR - totalBoxW;

    page.drawRectangle({ x: totalBoxX, y: y - 22, width: totalBoxW, height: 22, color: lightBg });
    page.drawText('Sous-total HT', { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
    const stStr = formatMoney(po.subtotal);
    const stW = font.widthOfTextAtSize(stStr, 10);
    page.drawText(stStr, { x: totalBoxX + totalBoxW - 15 - stW, y: y - 15, size: 10, font, color: primary });
    y -= 22;

    page.drawRectangle({ x: totalBoxX, y: y - 22, width: totalBoxW, height: 22, color: lightBg });
    page.drawText('TVA', { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
    const vtStr = formatMoney(po.vat_amount);
    const vtW = font.widthOfTextAtSize(vtStr, 10);
    page.drawText(vtStr, { x: totalBoxX + totalBoxW - 15 - vtW, y: y - 15, size: 10, font, color: primary });
    y -= 26;

    page.drawRectangle({ x: totalBoxX, y: y - 40, width: totalBoxW, height: 40, color: primary });
    page.drawText('TOTAL TTC', { x: totalBoxX + 15, y: y - 25, size: 10, font: boldFont, color: rgb(0.85, 0.9, 1) });
    const totStr = formatMoney(po.total);
    const totW = boldFont.widthOfTextAtSize(totStr, 16);
    page.drawText(totStr, { x: totalBoxX + totalBoxW - 15 - totW, y: y - 26, size: 16, font: boldFont, color: white });

    // Notes
    if (po.notes) {
        y -= 80;
        page.drawText('NOTES', { x: mL, y, size: 8, font: boldFont, color: lightGray });
        y -= 14;
        const notesLines = po.notes.match(/.{1,80}/g) || [];
        notesLines.slice(0, 5).forEach(line => {
            page.drawText(line, { x: mL, y, size: 9, font, color: darkGray });
            y -= 12;
        });
    }

    // Pied de page
    const footerY = 55;
    page.drawLine({
        start: { x: mL, y: footerY + 25 },
        end: { x: width - mR, y: footerY + 25 },
        thickness: 0.5,
        color: rgb(0.85, 0.88, 0.92)
    });

    page.drawText('Merci de confirmer la reception de ce bon de commande.', {
        x: mL, y: footerY, size: 8, font, color: darkGray
    });
    page.drawText('Toute livraison doit etre accompagnee d\'un bon de livraison mentionnant le numero de commande.', {
        x: mL, y: footerY - 14, size: 7, font, color: lightGray
    });

    const pageText = 'Page 1 / 1';
    const pageTextW = font.widthOfTextAtSize(pageText, 7);
    page.drawText(pageText, { x: (width - pageTextW) / 2, y: footerY - 14, size: 7, font, color: lightGray });

    return await pdfDoc.save();
}

module.exports = { generatePurchaseOrderPDF };