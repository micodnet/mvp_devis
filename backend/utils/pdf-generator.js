const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function generateQuotePDF(items, total, quoteNumber, issueDate, validDate, company) {
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
    // BANDEAU EN-TÊTE (bleu marine) — CORRECTEMENT POSITIONNÉ
    // ==========================================================
    const bannerHeight = 90;
    page.drawRectangle({
        x: 0,
        y: height - bannerHeight,
        width: width,
        height: bannerHeight,
        color: darkBlue,
    });

    // Titre "DEVIS" à gauche (dans le bandeau)
    page.drawText('DEVIS', {
        x: marginLeft,
        y: height - 48,
        size: 28,
        font: boldFont,
        color: white,
    });

    // Nom de la société en petit sous "DEVIS" (dans le bandeau)
    page.drawText(company.companyName || 'Votre Entreprise', {
        x: marginLeft,
        y: height - 70,
        size: 11,
        font: font,
        color: rgb(0.85, 0.9, 1),
    });

    // Numéro de devis à droite (dans le bandeau)
    const quoteWidth = boldFont.widthOfTextAtSize(quoteNumber, 16);
    page.drawText(quoteNumber, {
        x: width - marginRight - quoteWidth,
        y: height - 48,
        size: 16,
        font: boldFont,
        color: white,
    });

    // Date d'émission à droite (dans le bandeau)
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
    // BLOC COORDONNÉES SOCIÉTÉ (sur fond blanc, texte NOIR)
    // ==========================================================
    let y = height - bannerHeight - 30;

    // --- Logo (optionnel, à gauche) ---
    let logoWidth = 0;
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
                    x: marginLeft,
                    y: y - dims.height + 10,
                    width: dims.width,
                    height: dims.height,
                });
                logoWidth = dims.width + 15;
            }
        } catch (e) {
            console.warn('Logo ignoré :', e.message);
        }
    }

    // --- Coordonnées à droite du logo (ou à gauche si pas de logo) ---
    const infoX = marginLeft + logoWidth;

    page.drawText(company.companyName || 'Votre Entreprise', {
        x: infoX,
        y: y,
        size: 12,
        font: boldFont,
        color: black,
    });
    y -= 15;

    if (company.address) {
        page.drawText(company.address, {
            x: infoX, y: y, size: 9, font: font, color: darkGray,
        });
        y -= 12;
    }

    const contactParts = [];
    if (company.phone) contactParts.push(`Tél : ${company.phone}`);
    if (company.email) contactParts.push(`Email : ${company.email}`);
    if (contactParts.length > 0) {
        page.drawText(contactParts.join('   •   '), {
            x: infoX, y: y, size: 9, font: font, color: darkGray,
        });
        y -= 12;
    }

    // --- Bloc "Date de validité" à droite (noir sur blanc, LISIBLE) ---
    const rightX = width - marginRight;
    const validText = `Valable jusqu'au : ${validDate}`;
    const validWidth = font.widthOfTextAtSize(validText, 10);
    page.drawText(validText, {
        x: rightX - validWidth,
        y: height - bannerHeight - 30,
        size: 10,
        font: boldFont,
        color: darkGray,
    });

    const validLabel = 'DATE DE VALIDITÉ';
    const validLabelWidth = font.widthOfTextAtSize(validLabel, 7);
    page.drawText(validLabel, {
        x: rightX - validLabelWidth,
        y: height - bannerHeight - 44,
        size: 7,
        font: font,
        color: lightGray,
    });

    // ==========================================================
    // TABLEAU
    // ==========================================================
    y = Math.min(y, height - bannerHeight - 130) - 30;

    const colRef   = marginLeft;
    const colName  = marginLeft + 85;
    const colQty   = marginLeft + 290;
    const colPU    = marginLeft + 360;
    const colTotal = marginLeft + 445;

    // En-tête du tableau
    const headerHeight = 26;
    page.drawRectangle({
        x: marginLeft, y: y - headerHeight,
        width: contentWidth, height: headerHeight,
        color: headerBg,
    });

    page.drawText('Réf.',        { x: colRef + 5, y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Désignation', { x: colName,    y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Qté',         { x: colQty,     y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('P.U. HT',     { x: colPU,      y: y - 17, size: 9, font: boldFont, color: darkBlue });
    page.drawText('Total HT',    { x: colTotal,   y: y - 17, size: 9, font: boldFont, color: darkBlue });

    y -= headerHeight;

    // Lignes d'articles
    const rowHeight = 24;
    items.forEach((item, idx) => {
        if (idx % 2 === 0) {
            page.drawRectangle({
                x: marginLeft, y: y - rowHeight,
                width: contentWidth, height: rowHeight,
                color: rowAlt,
            });
        }

        // Référence
        page.drawText(item.ref || 'N/R', {
            x: colRef + 5, y: y - 15, size: 8, font: font, color: darkGray,
        });

        // Désignation (tronquée si trop longue)
        const maxNameWidth = colQty - colName - 10;
        let displayName = String(item.name || '');
        while (font.widthOfTextAtSize(displayName, 9) > maxNameWidth && displayName.length > 5) {
            displayName = displayName.slice(0, -2);
        }
        if (displayName !== item.name) displayName += '…';

        page.drawText(displayName, {
            x: colName, y: y - 15, size: 9, font: font, color: black,
        });

        // Quantité (centrée)
        const qtyStr = String(item.qty);
        const qtyW = font.widthOfTextAtSize(qtyStr, 9);
        page.drawText(qtyStr, {
            x: colQty + 15 - qtyW / 2, y: y - 15, size: 9, font: font, color: black,
        });

        // Prix unitaire (aligné à droite)
        const puStr = item.unitPrice.toFixed(2) + ' €';
        const puW = font.widthOfTextAtSize(puStr, 9);
        page.drawText(puStr, {
            x: colPU + 40 - puW, y: y - 15, size: 9, font: font, color: black,
        });

        // Total ligne (aligné à droite)
        const totStr = item.total.toFixed(2) + ' €';
        const totW = boldFont.widthOfTextAtSize(totStr, 9);
        page.drawText(totStr, {
            x: colTotal + 70 - totW, y: y - 15, size: 9, font: boldFont, color: darkBlue,
        });

        // Ligne de séparation
        page.drawLine({
            start: { x: marginLeft, y: y - rowHeight },
            end:   { x: marginLeft + contentWidth, y: y - rowHeight },
            thickness: 0.5,
            color: rgb(0.88, 0.9, 0.93),
        });

        y -= rowHeight;
    });

    // ==========================================================
    // BLOC TOTAL (aligné à droite, dans le cadre)
    // ==========================================================
    y -= 20;

    const totalBoxWidth = 210;
    const totalBoxHeight = 40;
    const totalBoxX = width - marginRight - totalBoxWidth;

    page.drawRectangle({
        x: totalBoxX, y: y - totalBoxHeight,
        width: totalBoxWidth, height: totalBoxHeight,
        color: darkBlue,
    });

    // Label
    page.drawText('TOTAL TTC', {
        x: totalBoxX + 15, y: y - 25,
        size: 10, font: boldFont, color: rgb(0.85, 0.9, 1),
    });

    // Montant (aligné à droite dans la boîte)
    const totalStr = total.toFixed(2) + ' €';
    const totalW = boldFont.widthOfTextAtSize(totalStr, 16);
    page.drawText(totalStr, {
        x: totalBoxX + totalBoxWidth - 15 - totalW,
        y: y - 26,
        size: 16, font: boldFont, color: white,
    });

    // ==========================================================
    // PIED DE PAGE (SIRET, TVA, mentions) — LISIBLE
    // ==========================================================
    const footerY = 55;

    // Ligne de séparation
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
            x: marginLeft, y: footerY,
            size: 8, font: font, color: darkGray,
        });
    }

    page.drawText('Devis généré automatiquement — Document non contractuel jusqu\'à acceptation écrite.', {
        x: marginLeft, y: footerY - 14,
        size: 7, font: font, color: lightGray,
    });

    // Pagination (centré bas)
    const pageText = 'Page 1 / 1';
    const pageTextWidth = font.widthOfTextAtSize(pageText, 7);
    page.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: footerY - 14,
        size: 7, font: font, color: lightGray,
    });

    return await pdfDoc.save();
}

module.exports = { generateQuotePDF };