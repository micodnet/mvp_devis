const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function generateQuotePDF(items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client, signature = null) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const marginLeft = 40;
    const marginRight = 40;
    const contentWidth = width - marginLeft - marginRight;

    // Couleurs
    const darkBlue  = rgb(0.05, 0.12, 0.25);
    const black     = rgb(0, 0, 0);
    const darkGray  = rgb(0.25, 0.28, 0.33);
    const lightGray = rgb(0.55, 0.58, 0.62);
    const rowAlt    = rgb(0.97, 0.98, 0.99);
    const headerBg  = rgb(0.93, 0.95, 0.97);
    const white     = rgb(1, 1, 1);

    // ==========================================================
    // BANDEAU EN-TÊTE
    // ==========================================================
    const bannerHeight = 90;
    page.drawRectangle({
        x: 0,
        y: height - bannerHeight,
        width: width,
        height: bannerHeight,
        color: darkBlue,
    });

    page.drawText('DEVIS', {
        x: marginLeft,
        y: height - 48,
        size: 28,
        font: boldFont,
        color: white,
    });

    page.drawText(company.companyName || 'Votre Entreprise', {
        x: marginLeft,
        y: height - 70,
        size: 11,
        font: font,
        color: rgb(0.85, 0.9, 1),
    });

    const quoteWidth = boldFont.widthOfTextAtSize(quoteNumber, 16);
    page.drawText(quoteNumber, {
        x: width - marginRight - quoteWidth,
        y: height - 48,
        size: 16,
        font: boldFont,
        color: white,
    });

    const issueText = `Émis le : ${issueDate}`;
    const issueWidth = font.widthOfTextAtSize(issueText, 10);
    page.drawText(issueText, {
        x: width - marginRight - issueWidth,
        y: height - 70,
        size: 10,
        font: font,
        color: rgb(0.85, 0.9, 1),
    });

    // ==========================================================
    // BLOCS ÉMETTEUR / CLIENT
    // ==========================================================
    const blockTopY = height - bannerHeight - 30;
    const colLeftX = marginLeft;
    const colRightX = width / 2 + 10;
    const colWidth = width / 2 - 60;

    // ---- ÉMETTEUR (gauche) ----
    let ly = blockTopY;

    // Logo (décalé proprement vers le bas après dessin)
    if (company.logo) {
        try {
            const base64 = company.logo.replace(/^data:image\/\w+;base64,/, '');
            const imageBuffer = Buffer.from(base64, 'base64');
            if (imageBuffer.length > 0) {
                let image;
                try {
                    image = await pdfDoc.embedPng(imageBuffer);
                } catch (e) {
                    image = await pdfDoc.embedJpg(imageBuffer);
                }
                const dims = image.scaleToFit(80, 60);
                page.drawImage(image, {
                    x: colLeftX,
                    y: ly - dims.height,
                    width: dims.width,
                    height: dims.height,
                });
                // CORRECTION : on descend ly APRÈS avoir dessiné le logo
                ly = ly - dims.height - 10;
            }
        } catch (e) {
            console.warn('Logo ignoré :', e.message);
        }
    }

    page.drawText('ÉMETTEUR', { x: colLeftX, y: ly, size: 7, font: boldFont, color: lightGray });
    ly -= 14;
    page.drawText(company.companyName || 'Votre Entreprise', {
        x: colLeftX,
        y: ly,
        size: 12,
        font: boldFont,
        color: black,
    });
    ly -= 14;

    if (company.address) {
        const lines = wrapText(company.address, font, 9, colWidth);
        lines.forEach(l => {
            page.drawText(l, { x: colLeftX, y: ly, size: 9, font: font, color: darkGray });
            ly -= 11;
        });
    }

    const contactParts = [];
    if (company.phone) contactParts.push(`Tél : ${company.phone}`);
    if (company.email) contactParts.push(`Email : ${company.email}`);
    if (contactParts.length > 0) {
        page.drawText(contactParts.join('   •   '), {
            x: colLeftX,
            y: ly,
            size: 9,
            font: font,
            color: darkGray,
        });
        ly -= 11;
    }
    if (company.siret) {
        page.drawText(`SIRET : ${company.siret}`, { x: colLeftX, y: ly, size: 8, font: font, color: darkGray });
        ly -= 11;
    }
    if (company.tva && vatRegime === 'assujetti') {
        page.drawText(`TVA : ${company.tva}`, { x: colLeftX, y: ly, size: 8, font: font, color: darkGray });
        ly -= 11;
    }

    // ---- CLIENT (droite) ----
    let ry = blockTopY;
    const clientBoxHeight = 100;
    page.drawRectangle({
        x: colRightX - 8,
        y: ry - clientBoxHeight,
        width: width - marginRight - colRightX + 8,
        height: clientBoxHeight,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: rgb(0.85, 0.88, 0.92),
        borderWidth: 0.5,
    });

    ry -= 12;
    page.drawText('CLIENT', { x: colRightX, y: ry, size: 7, font: boldFont, color: lightGray });
    ry -= 14;
    page.drawText(client?.name || '—', { x: colRightX, y: ry, size: 11, font: boldFont, color: black });
    ry -= 14;
    if (client?.address) {
        const lines = wrapText(client.address, font, 9, width - marginRight - colRightX - 10);
        lines.forEach(l => {
            page.drawText(l, { x: colRightX, y: ry, size: 9, font: font, color: darkGray });
            ry -= 11;
        });
    }
    if (client?.vat) {
        page.drawText(`TVA : ${client.vat}`, { x: colRightX, y: ry, size: 9, font: font, color: darkGray });
        ry -= 11;
    }
    if (client?.email) {
        page.drawText(client.email, { x: colRightX, y: ry, size: 9, font: font, color: darkGray });
    }

    // ---- DATE DE VALIDITÉ ----
    let y = Math.min(ly, blockTopY - clientBoxHeight) - 20;
    const rightX = width - marginRight;
    const validText = `Valable jusqu'au : ${validDate}`;
    const validWidth = font.widthOfTextAtSize(validText, 10);
    page.drawText(validText, {
        x: rightX - validWidth,
        y: y,
        size: 10,
        font: boldFont,
        color: darkGray,
    });

    // ==========================================================
    // TABLEAU
    // ==========================================================
    y -= 30;

    const colRef   = marginLeft;
    const colName  = marginLeft + 85;
    const colQty   = marginLeft + 290;
    const colPU    = marginLeft + 360;
    const colTotal = marginLeft + 445;

    const headerHeight = 26;
    page.drawRectangle({
        x: marginLeft,
        y: y - headerHeight,
        width: contentWidth,
        height: headerHeight,
        color: headerBg,
    });

    page.drawText('Réf.',        { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Désignation', { x: colName,    y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Qté',         { x: colQty,     y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('P.U. HT',     { x: colPU,      y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Total HT',    { x: colTotal,   y: y - 17, size: 9, font: boldFont, color: darkBlue });

    y -= headerHeight;

    const rowHeight = 24;
    items.forEach((item, idx) => {
        if (idx % 2 === 0) {
            page.drawRectangle({
                x: marginLeft,
                y: y - rowHeight,
                width: contentWidth,
                height: rowHeight,
                color: rowAlt,
            });
        }

        page.drawText(item.ref || 'N/R', {
            x: colRef + 5,
            y: y - 15,
            size: 8,
            font: font,
            color: darkGray,
        });

        const maxNameWidth = colQty - colName - 10;
        let displayName = String(item.name || '');
        while (font.widthOfTextAtSize(displayName, 9) > maxNameWidth && displayName.length > 5) {
            displayName = displayName.slice(0, -2);
        }
        if (displayName !== item.name) displayName += '…';

        page.drawText(displayName, {
            x: colName,
            y: y - 15,
            size: 9,
            font: font,
            color: black,
        });

        const qtyStr = String(item.qty);
        const qtyW = font.widthOfTextAtSize(qtyStr, 9);
        page.drawText(qtyStr, {
            x: colQty + 15 - qtyW / 2,
            y: y - 15,
            size: 9,
            font: font,
            color: black,
        });

        const puStr = item.unitPrice.toFixed(2) + ' €';
        const puW = font.widthOfTextAtSize(puStr, 9);
        page.drawText(puStr, {
            x: colPU + 40 - puW,
            y: y - 15,
            size: 9,
            font: font,
            color: black,
        });

        const totStr = item.total.toFixed(2) + ' €';
        const totW = boldFont.widthOfTextAtSize(totStr, 9);
        page.drawText(totStr, {
            x: colTotal + 70 - totW,
            y: y - 15,
            size: 9,
            font: boldFont,
            color: darkBlue,
        });

        page.drawLine({
            start: { x: marginLeft, y: y - rowHeight },
            end:   { x: marginLeft + contentWidth, y: y - rowHeight },
            thickness: 0.5,
            color: rgb(0.88, 0.9, 0.93),
        });

        y -= rowHeight;
    });

    // ==========================================================
    // BLOC TOTAL
    // ==========================================================
    y -= 20;

    const totalBoxWidth = 230;
    const totalBoxX = width - marginRight - totalBoxWidth;

    if (vatRegime === 'assujetti') {
        // ---- Ligne Total HT ----
        const boxH1 = 22;
        page.drawRectangle({
            x: totalBoxX,
            y: y - boxH1,
            width: totalBoxWidth,
            height: boxH1,
            color: rgb(0.96, 0.97, 0.99),
        });
        page.drawText('Total HT', {
            x: totalBoxX + 15,
            y: y - 15,
            size: 10,
            font: font,
            color: darkGray,
        });
        const stStr = subtotal.toFixed(2) + ' €';
        const stW = font.widthOfTextAtSize(stStr, 10);
        page.drawText(stStr, {
            x: totalBoxX + totalBoxWidth - 15 - stW,
            y: y - 15,
            size: 10,
            font: font,
            color: black,
        });
        y -= boxH1;

        // ---- Ligne TVA ----
        const boxH2 = 22;
        page.drawRectangle({
            x: totalBoxX,
            y: y - boxH2,
            width: totalBoxWidth,
            height: boxH2,
            color: rgb(0.96, 0.97, 0.99),
        });
        page.drawText(`TVA (${vatRate}%)`, {
            x: totalBoxX + 15,
            y: y - 15,
            size: 10,
            font: font,
            color: darkGray,
        });
        const vtStr = vatAmount.toFixed(2) + ' €';
        const vtW = font.widthOfTextAtSize(vtStr, 10);
        page.drawText(vtStr, {
            x: totalBoxX + totalBoxWidth - 15 - vtW,
            y: y - 15,
            size: 10,
            font: font,
            color: black,
        });
        y -= boxH2;
        y -= 4;
    }

    // ---- Ligne Total TTC ----
    const boxH3 = 40;
    page.drawRectangle({
        x: totalBoxX,
        y: y - boxH3,
        width: totalBoxWidth,
        height: boxH3,
        color: darkBlue,
    });
    page.drawText(vatRegime === 'assujetti' ? 'TOTAL TTC' : 'TOTAL', {
        x: totalBoxX + 15,
        y: y - 25,
        size: 10,
        font: boldFont,
        color: rgb(0.85, 0.9, 1),
    });

    const totalStr = total.toFixed(2) + ' €';
    const totalW = boldFont.widthOfTextAtSize(totalStr, 16);
    page.drawText(totalStr, {
        x: totalBoxX + totalBoxWidth - 15 - totalW,
        y: y - 26,
        size: 16,
        font: boldFont,
        color: white,
    });

    // ==========================================================
    // PIED DE PAGE
    // ==========================================================
    const footerY = 55;

    page.drawLine({
        start: { x: marginLeft, y: footerY + 25 },
        end:   { x: width - marginRight, y: footerY + 25 },
        thickness: 0.5,
        color: rgb(0.85, 0.88, 0.92),
    });

    const legalParts = [];
    if (company.siret) legalParts.push(`SIRET : ${company.siret}`);
    if (company.tva)   legalParts.push(`TVA : ${company.tva}`);
    if (company.website) legalParts.push(company.website);
    if (legalParts.length > 0) {
        page.drawText(legalParts.join('   •   '), {
            x: marginLeft,
            y: footerY,
            size: 8,
            font: font,
            color: darkGray,
        });
    }

    if (vatRegime === 'franchise') {
        page.drawText('Régime particulier de franchise des petites entreprises — TVA non applicable.', {
            x: marginLeft, y: footerY - 14, size: 7, font: font, color: lightGray,
        });
    } else {
        page.drawText('Paiement à 30 jours. Devis valable jusqu\'à la date indiquée ci-dessus.', {
            x: marginLeft, y: footerY - 14, size: 7, font: font, color: lightGray,
        });
    }
    page.drawText('Devis généré automatiquement — Document non contractuel jusqu\'à acceptation écrite.', {
        x: marginLeft, y: footerY - 26, size: 7, font: font, color: lightGray,
    });

    // ==========================================================
    // BLOC SIGNATURE (si le devis est signé)
    // ==========================================================
    if (signature && signature.signedAt) {
        const signY = footerY + 110;

        // Titre
        page.drawText('SIGNATURE DU CLIENT', {
            x: marginLeft, y: signY + 20, size: 8, font: boldFont, color: darkGray
        });

        // Cadre
        page.drawRectangle({
            x: marginLeft, y: signY - 60,
            width: 250, height: 75,
            color: rgb(0.98, 0.99, 1),
            borderColor: rgb(0.85, 0.88, 0.92),
            borderWidth: 0.5
        });

        // Contenu
        const sigLines = [];
        sigLines.push(`Signé par : ${signature.signedBy || 'N/A'}`);
        const signedDate = new Date(signature.signedAt).toLocaleString('fr-FR');
        sigLines.push(`Le : ${signedDate}`);
        if (signature.ip) sigLines.push(`IP : ${signature.ip}`);
        sigLines.push(`Méthode : ${signature.method === 'draw' ? 'Signature manuscrite' : 'Acceptation électronique'}`);

        let sigYPos = signY + 5;
        sigLines.forEach(line => {
            page.drawText(line, {
                x: marginLeft + 10, y: sigYPos, size: 8, font: font, color: darkGray
            });
            sigYPos -= 11;
        });

        // Si signature manuscrite, dessiner l'image
        if (signature.method === 'draw' && signature.data) {
            try {
                const sigBase64 = signature.data.replace(/^data:image\/\w+;base64,/, '');
                const sigBuffer = Buffer.from(sigBase64, 'base64');
                if (sigBuffer.length > 0) {
                    const sigImage = await pdfDoc.embedPng(sigBuffer);
                    const sigDims = sigImage.scaleToFit(220, 60);
                    page.drawImage(sigImage, {
                        x: marginLeft + 260,
                        y: signY - 50,
                        width: sigDims.width,
                        height: sigDims.height
                    });
                }
            } catch (e) {
                console.warn('Signature non lisible:', e.message);
            }
        }

        // Marqueur "Accepté" à droite
        if (signature.method === 'checkbox') {
            page.drawRectangle({
                x: marginLeft + 260, y: signY - 50,
                width: 220, height: 60,
                color: rgb(0.88, 0.97, 0.9),
                borderColor: rgb(0.13, 0.77, 0.37),
                borderWidth: 1
            });
            page.drawText('✓ DEVIS ACCEPTÉ', {
                x: marginLeft + 285, y: signY - 15,
                size: 14, font: boldFont, color: rgb(0.09, 0.6, 0.27)
            });
            page.drawText('Acceptation électronique', {
                x: marginLeft + 300, y: signY - 35,
                size: 9, font: font, color: rgb(0.09, 0.6, 0.27)
            });
        }
    }
    const pageText = 'Page 1 / 1';
    const pageTextWidth = font.widthOfTextAtSize(pageText, 7);
    page.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: footerY - 14,
        size: 7,
        font: font,
        color: lightGray,
    });

    return await pdfDoc.save();
}

// Utilitaire : découpe un texte en lignes selon une largeur max
function wrapText(text, font, size, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) > maxWidth) {
            if (current) lines.push(current);
            current = word;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}

module.exports = { generateQuotePDF };