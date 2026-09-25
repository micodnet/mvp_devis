// backend/utils/pdf-generator.js
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { t, formatDate } = require('./i18n');

// ------------------------------------------------------------------
// HELPERS COMMUNS
// ------------------------------------------------------------------
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

// Palettes de couleurs selon le template
const PALETTES = {
    classic: {
        primary: rgb(0.05, 0.12, 0.25),
        accent:  rgb(0.05, 0.12, 0.25),
        light:   rgb(0.93, 0.95, 0.97),
        alt:     rgb(0.97, 0.98, 0.99)
    },
    modern: {
        primary: rgb(0.06, 0.09, 0.16),
        accent:  rgb(0.23, 0.51, 1.0),
        light:   rgb(0.94, 0.96, 1.0),
        alt:     rgb(0.97, 0.98, 1.0)
    },
    elegant: {
        primary: rgb(0.08, 0.12, 0.22),
        accent:  rgb(0.98, 0.45, 0.09),
        light:   rgb(0.98, 0.96, 0.93),
        alt:     rgb(0.99, 0.98, 0.96)
    }
};

async function generateQuotePDF(items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client, signature = null, lang = 'fr', template = 'classic') {
    const palette = PALETTES[template] || PALETTES.classic;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const mL = 40, mR = 40;
    const cW = width - mL - mR;

    const black = rgb(0, 0, 0);
    const darkGray = rgb(0.25, 0.28, 0.33);
    const lightGray = rgb(0.55, 0.58, 0.62);
    const white = rgb(1, 1, 1);
    const green = rgb(0.13, 0.6, 0.27);

    const L = (key) => t(lang, `quote.${key}`);

    // Chaque template dessine son en-tête différemment
    let currentY;

    if (template === 'modern') {
        // ---- MODERN : barre latérale + titre en haut à gauche ----
        page.drawRectangle({ x: 0, y: 0, width: 6, height: height, color: palette.accent });

        // Logo en haut à droite
        if (company.logo) {
            try {
                const b64 = company.logo.replace(/^data:image\/\w+;base64,/, '');
                const buf = Buffer.from(b64, 'base64');
                if (buf.length > 0) {
                    let img;
                    try { img = await pdfDoc.embedPng(buf); } catch { img = await pdfDoc.embedJpg(buf); }
                    const d = img.scaleToFit(90, 50);
                    page.drawImage(img, { x: width - mR - d.width, y: height - 60, width: d.width, height: d.height });
                }
            } catch (e) {}
        }

        // Titre
        page.drawText(L('title'), { x: mL, y: height - 70, size: 36, font: boldFont, color: palette.primary });
        // Ligne sous le titre
        page.drawLine({ start: { x: mL, y: height - 85 }, end: { x: mL + 60, y: height - 85 }, thickness: 3, color: palette.accent });

        // Métadonnées à droite
        page.drawText(quoteNumber, { x: mL, y: height - 115, size: 11, font: boldFont, color: palette.accent });
        page.drawText(`${L('issued_on')} : ${formatDate(lang, issueDate)}`, { x: mL, y: height - 130, size: 9, font, color: darkGray });
        page.drawText(`${L('valid_until')} : ${formatDate(lang, validDate)}`, { x: mL, y: height - 143, size: 9, font, color: darkGray });

        currentY = height - 190;

    } else if (template === 'elegant') {
        // ---- ELEGANT : bandeau dégradé + titre centré ----
        const bannerH = 110;
        page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: palette.primary });
        // Bande accent en bas du bandeau
        page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: 4, color: palette.accent });

        page.drawText(L('title'), { x: 0, y: height - 50, size: 32, font: boldFont, color: white });

        // Centrer le titre
        const titleW = boldFont.widthOfTextAtSize(L('title'), 32);
        page.drawRectangle({ x: 0, y: 0, width: 0, height: 0 }); // noop
        // Redessiner à la bonne position
        page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: palette.primary });
        page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: 4, color: palette.accent });
        page.drawText(L('title'), { x: (width - titleW) / 2, y: height - 50, size: 32, font: boldFont, color: white });

        // Ligne fine sous le titre
        page.drawLine({ start: { x: width / 2 - 40, y: height - 65 }, end: { x: width / 2 + 40, y: height - 65 }, thickness: 1, color: palette.accent });

        // Nom entreprise centré
        const compW = font.widthOfTextAtSize(company.companyName || 'Votre Entreprise', 12);
        page.drawText(company.companyName || 'Votre Entreprise', { x: (width - compW) / 2, y: height - 85, size: 12, font, color: rgb(0.85, 0.9, 1) });

        // Numéro en bas du bandeau, aligné centre
        const quoteW = boldFont.widthOfTextAtSize(quoteNumber, 11);
        page.drawText(quoteNumber, { x: (width - quoteW) / 2, y: height - 102, size: 11, font: boldFont, color: palette.accent });

        currentY = height - bannerH - 40;

    } else {
        // ---- CLASSIC (défaut) : bandeau plein ----
        const bannerH = 90;
        page.drawRectangle({ x: 0, y: height - bannerH, width: width, height: bannerH, color: palette.primary });

        page.drawText(L('title'), { x: mL, y: height - 48, size: 28, font: boldFont, color: white });
        page.drawText(company.companyName || 'Votre Entreprise', { x: mL, y: height - 70, size: 11, font, color: rgb(0.85, 0.9, 1) });

        const quoteW = boldFont.widthOfTextAtSize(quoteNumber, 16);
        page.drawText(quoteNumber, { x: width - mR - quoteW, y: height - 48, size: 16, font: boldFont, color: white });

        const issueText = `${L('issued_on')} : ${formatDate(lang, issueDate)}`;
        const issueW = font.widthOfTextAtSize(issueText, 10);
        page.drawText(issueText, { x: width - mR - issueW, y: height - 70, size: 10, font, color: rgb(0.85, 0.9, 1) });

        currentY = height - bannerH - 30;
    }

    // ========== BLOCS ÉMETTEUR / CLIENT ==========
    let ly = currentY;
    const colLeftX = mL;
    const colRightX = width / 2 + 10;
    const colWidth = width / 2 - 60;

    // Logo (sauf modern qui l'a déjà mis en haut à droite)
    if (template !== 'modern' && company.logo) {
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
        } catch (e) {}
    }

    // ÉMETTEUR
    page.drawText(L('sender'), { x: colLeftX, y: ly, size: 7, font: boldFont, color: lightGray });
    ly -= 14;
    page.drawText(company.companyName || 'Votre Entreprise', { x: colLeftX, y: ly, size: 12, font: boldFont, color: black });
    ly -= 14;
    if (company.address) {
        wrapText(company.address, font, 9, colWidth).forEach(l => { page.drawText(l, { x: colLeftX, y: ly, size: 9, font, color: darkGray }); ly -= 11; });
    }
    const contactParts = [];
    if (company.phone) contactParts.push(`Tél : ${company.phone}`);
    if (company.email) contactParts.push(`Email : ${company.email}`);
    if (contactParts.length > 0) { page.drawText(contactParts.join('   •   '), { x: colLeftX, y: ly, size: 9, font, color: darkGray }); ly -= 11; }
    if (company.siret) { page.drawText(`BCE : ${company.siret}`, { x: colLeftX, y: ly, size: 8, font, color: darkGray }); ly -= 11; }
    if (company.tva && vatRegime === 'assujetti') { page.drawText(`TVA : ${company.tva}`, { x: colLeftX, y: ly, size: 8, font, color: darkGray }); ly -= 11; }

    // CLIENT (avec cadre)
    let ry = currentY;
    const clientBoxHeight = 100;
    if (template === 'elegant') {
        page.drawRectangle({ x: colRightX - 8, y: ry - clientBoxHeight, width: width - mR - colRightX + 8, height: clientBoxHeight, color: palette.light, borderColor: palette.accent, borderWidth: 0.7 });
    } else if (template === 'modern') {
        page.drawRectangle({ x: colRightX - 8, y: ry - clientBoxHeight, width: width - mR - colRightX + 8, height: clientBoxHeight, color: palette.light });
        page.drawLine({ start: { x: colRightX - 8, y: ry - clientBoxHeight }, end: { x: colRightX - 8, y: ry }, thickness: 2, color: palette.accent });
    } else {
        page.drawRectangle({ x: colRightX - 8, y: ry - clientBoxHeight, width: width - mR - colRightX + 8, height: clientBoxHeight, color: rgb(0.96, 0.97, 0.99), borderColor: rgb(0.85, 0.88, 0.92), borderWidth: 0.5 });
    }

    ry -= 12;
    page.drawText(L('client'), { x: colRightX, y: ry, size: 7, font: boldFont, color: lightGray });
    ry -= 14;
    page.drawText(client?.name || '—', { x: colRightX, y: ry, size: 11, font: boldFont, color: black });
    ry -= 14;
    if (client?.address) { wrapText(client.address, font, 9, width - mR - colRightX - 10).forEach(l => { page.drawText(l, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }); }
    if (client?.vat) { page.drawText(`TVA : ${client.vat}`, { x: colRightX, y: ry, size: 9, font, color: darkGray }); ry -= 11; }
    if (client?.email) { page.drawText(client.email, { x: colRightX, y: ry, size: 9, font, color: darkGray }); }

    // ========== TABLEAU ==========
    let y = Math.min(ly, currentY - clientBoxHeight) - 30;

    const colRef = mL;
    const colName = mL + 85;
    const colQty = mL + 290;
    const colPU = mL + 360;
    const colTotal = mL + 445;

    const headerHeight = 26;
    page.drawRectangle({ x: mL, y: y - headerHeight, width: cW, height: headerHeight, color: palette.light });

    page.drawText(L('table.ref'),        { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: palette.primary });
    page.drawText(L('table.name'),       { x: colName,    y: y - 17, size: 9, font: boldFont, color: palette.primary });
    page.drawText(L('table.qty'),        { x: colQty,     y: y - 17, size: 9, font: boldFont, color: palette.primary });
    page.drawText(L('table.unit_price'), { x: colPU,      y: y - 17, size: 9, font: boldFont, color: palette.primary });
    page.drawText(L('table.total_ht'),   { x: colTotal,   y: y - 17, size: 9, font: boldFont, color: palette.primary });

    y -= headerHeight;

    const rowH = 24;
    items.forEach((item, idx) => {
        if (idx % 2 === 0) page.drawRectangle({ x: mL, y: y - rowH, width: cW, height: rowH, color: palette.alt });
        page.drawText(item.ref || 'N/R', { x: colRef + 5, y: y - 15, size: 8, font, color: darkGray });
        const maxNameW = colQty - colName - 10;
        let dn = String(item.name || '');
        while (font.widthOfTextAtSize(dn, 9) > maxNameW && dn.length > 5) dn = dn.slice(0, -2);
        if (dn !== item.name) dn += '…';
        page.drawText(dn, { x: colName, y: y - 15, size: 9, font, color: black });
        const qs = String(item.qty);
        const qw = font.widthOfTextAtSize(qs, 9);
        page.drawText(qs, { x: colQty + 15 - qw / 2, y: y - 15, size: 9, font, color: black });
        const pus = parseFloat(item.unitPrice).toFixed(2) + ' €';
        const puw = font.widthOfTextAtSize(pus, 9);
        page.drawText(pus, { x: colPU + 40 - puw, y: y - 15, size: 9, font, color: black });
        const ts = parseFloat(item.total).toFixed(2) + ' €';
        const tw = boldFont.widthOfTextAtSize(ts, 9);
        page.drawText(ts, { x: colTotal + 70 - tw, y: y - 15, size: 9, font: boldFont, color: palette.primary });
        page.drawLine({ start: { x: mL, y: y - rowH }, end: { x: mL + cW, y: y - rowH }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
        y -= rowH;
    });

    // ========== TOTAUX ==========
    y -= 20;
    const totalBoxWidth = 230;
    const totalBoxX = width - mR - totalBoxWidth;

    if (vatRegime === 'assujetti') {
        page.drawRectangle({ x: totalBoxX, y: y - 22, width: totalBoxWidth, height: 22, color: palette.light });
        page.drawText(L('totals.subtotal'), { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
        const stStr = subtotal.toFixed(2) + ' €';
        const stW = font.widthOfTextAtSize(stStr, 10);
        page.drawText(stStr, { x: totalBoxX + totalBoxWidth - 15 - stW, y: y - 15, size: 10, font, color: black });
        y -= 22;

        page.drawRectangle({ x: totalBoxX, y: y - 22, width: totalBoxWidth, height: 22, color: palette.light });
        page.drawText(`${L('totals.vat')} (${vatRate}%)`, { x: totalBoxX + 15, y: y - 15, size: 10, font, color: darkGray });
        const vtStr = vatAmount.toFixed(2) + ' €';
        const vtW = font.widthOfTextAtSize(vtStr, 10);
        page.drawText(vtStr, { x: totalBoxX + totalBoxWidth - 15 - vtW, y: y - 15, size: 10, font, color: black });
        y -= 22;
        y -= 4;
    }

    page.drawRectangle({ x: totalBoxX, y: y - 40, width: totalBoxWidth, height: 40, color: palette.primary });
    page.drawText(vatRegime === 'assujetti' ? L('totals.total_ttc') : L('totals.total'), { x: totalBoxX + 15, y: y - 25, size: 10, font: boldFont, color: rgb(0.85, 0.9, 1) });
    const totStr = total.toFixed(2) + ' €';
    const totW = boldFont.widthOfTextAtSize(totStr, 16);
    page.drawText(totStr, { x: totalBoxX + totalBoxWidth - 15 - totW, y: y - 26, size: 16, font: boldFont, color: white });

    // ========== SIGNATURE ==========
    if (signature && signature.signedAt) {
        const signY = 200;
        page.drawText(t(lang, 'signature.title'), { x: mL, y: signY + 20, size: 8, font: boldFont, color: darkGray });
        page.drawRectangle({ x: mL, y: signY - 60, width: 250, height: 75, color: palette.alt, borderColor: palette.light, borderWidth: 0.5 });
        const sigLines = [
            `${t(lang, 'signature.signed_by')} : ${signature.signedBy || 'N/A'}`,
            `${t(lang, 'signature.on_date')} : ${new Date(signature.signedAt).toLocaleString(lang === 'en' ? 'en-GB' : (lang === 'nl' ? 'nl-BE' : 'fr-FR'))}`
        ];
        if (signature.ip) sigLines.push(`${t(lang, 'signature.ip')} : ${signature.ip}`);
        sigLines.push(`${t(lang, 'signature.method')} : ${signature.method === 'draw' ? t(lang, 'signature.draw') : t(lang, 'signature.checkbox')}`);
        let sy = signY + 5;
        sigLines.forEach(l => { page.drawText(l, { x: mL + 10, y: sy, size: 8, font, color: darkGray }); sy -= 11; });

        if (signature.method === 'draw' && signature.data) {
            try {
                const sb = signature.data.replace(/^data:image\/\w+;base64,/, '');
                const sbuf = Buffer.from(sb, 'base64');
                if (sbuf.length > 0) {
                    const si = await pdfDoc.embedPng(sbuf);
                    const sd = si.scaleToFit(220, 60);
                    page.drawImage(si, { x: mL + 260, y: signY - 50, width: sd.width, height: sd.height });
                }
            } catch (e) {}
        }
        if (signature.method === 'checkbox') {
            page.drawRectangle({ x: mL + 260, y: signY - 50, width: 220, height: 60, color: rgb(0.88, 0.97, 0.9), borderColor: green, borderWidth: 1 });
            page.drawText(t(lang, 'signature.accepted'), { x: mL + 275, y: signY - 15, size: 13, font: boldFont, color: green });
            page.drawText(t(lang, 'signature.checkbox'), { x: mL + 295, y: signY - 35, size: 9, font, color: green });
        }
    }

    const QRCode = require('qrcode');

    // 🆕 Ajouter le QR code de vérification si le devis est signé
    if (quoteData.signatureVerificationToken) {
        try {
            const verifyUrl = `${process.env.APP_URL || 'https://mvp-devis.onrender.com'}/verify.html?token=${quoteData.signatureVerificationToken}`;
            
            // Générer le QR code en base64
            const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 100, margin: 1, color: { dark: '#0b1120', light: '#ffffff' } });
            
            // Extraire les données base64
            const qrBase64 = qrDataUrl.split(',')[1];
            const qrBytes = Buffer.from(qrBase64, 'base64');
            
            // Intégrer dans le PDF
            const qrImage = await pdfDoc.embedPng(qrBytes);
            
            // Positionner le QR code en bas à droite
            const qrSize = 60;
            page.drawImage(qrImage, { x: page.getWidth() - qrSize - 40, y: 40, width: qrSize, height: qrSize });
            
            // Texte explicatif
            page.drawText('Scan pour vérifier', { x: page.getWidth() - qrSize - 55, y: 110, size: 7, font: font, color: rgb(0.4, 0.4, 0.4) });
        } catch (err) { console.warn('Erreur intégration QR code:', err.message); }
    }
        
    
    // ========== PIED DE PAGE ==========
    const footerY = 55;
    page.drawLine({ start: { x: mL, y: footerY + 25 }, end: { x: width - mR, y: footerY + 25 }, thickness: 0.5, color: rgb(0.85, 0.88, 0.92) });

    const legalParts = [];
    if (company.siret) legalParts.push(`BCE : ${company.siret}`);
    if (company.tva) legalParts.push(`TVA : ${company.tva}`);
    if (company.website) legalParts.push(company.website);
    if (legalParts.length > 0) page.drawText(legalParts.join('   •   '), { x: mL, y: footerY, size: 8, font, color: darkGray });

    if (vatRegime === 'franchise') {
        page.drawText(L('vat_franchise'), { x: mL, y: footerY - 14, size: 7, font, color: lightGray });
    } else {
        page.drawText(L('payment_terms'), { x: mL, y: footerY - 14, size: 7, font, color: lightGray });
    }
    page.drawText(L('legal_notice'), { x: mL, y: footerY - 26, size: 7, font, color: lightGray });

    const pageText = `${t(lang, 'quote.page')} 1 / 1`;
    const pageTextW = font.widthOfTextAtSize(pageText, 7);
    page.drawText(pageText, { x: (width - pageTextW) / 2, y: footerY - 14, size: 7, font, color: lightGray });

    return await pdfDoc.save();
}

module.exports = { generateQuotePDF };