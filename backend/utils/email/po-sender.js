// backend/utils/email/po-sender.js
// Envoi d'un bon de commande par email au fournisseur

const { Resend } = require('resend');
const { generatePurchaseOrderPDF } = require('../pdf-generator-po');

/**
 * Formate un montant pour l'affichage (evite les espaces insecables)
 */
function formatMoney(n) {
    const num = parseFloat(n) || 0;
    const parts = num.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return intPart + ',' + parts[1] + ' EUR';
}

/**
 * Formate une date en JJ/MM/AAAA
 */
function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return day + '/' + month + '/' + year;
}

/**
 * Envoie un bon de commande par email au fournisseur avec le PDF en piece jointe.
 *
 * @param {Object} po - Le bon de commande (depuis la table purchase_orders)
 * @param {Array} items - Les lignes du BC (depuis purchase_order_items)
 * @param {Object} company - Les settings de l'entreprise (company_name, address, email, phone)
 * @param {Object} supplier - Le fournisseur (name, email, address, contactName, phone)
 * @param {string} recipientEmail - L'email de destination (obligatoire)
 * @returns {Promise<Object>} - { messageId, sentTo }
 */
async function sendPurchaseOrderEmail(po, items, company, supplier, recipientEmail) {
    if (!recipientEmail) {
        throw new Error('Email du destinataire requis.');
    }

    if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY non configure. Envoi d\'email impossible.');
    }

    // Generer le PDF
    let pdfBytes;
    try {
        pdfBytes = await generatePurchaseOrderPDF(
            {
                poNumber: po.po_number,
                issueDate: po.issue_date,
                expectedDate: po.expected_date,
                total: parseFloat(po.total) || 0,
                subtotal: parseFloat(po.subtotal) || 0,
                notes: po.notes
            },
            items,
            company,
            supplier,
            'fr'
        );
    } catch (pdfErr) {
        throw new Error('Erreur generation PDF : ' + pdfErr.message);
    }

    // Preparer le contenu HTML
    const companyName = company.company_name || company.companyName || 'Notre entreprise';
    const supplierName = supplier.name || 'Cher fournisseur';
    const totalFormatted = formatMoney(po.total);
    const issueDateFormatted = formatDate(po.issue_date);
    const expectedDateFormatted = po.expected_date ? formatDate(po.expected_date) : null;

    const itemsTableRows = items.slice(0, 20).map(it => {
        const qty = parseFloat(it.quantity) || 0;
        const unitPrice = parseFloat(it.unit_price) || 0;
        const lineTotal = parseFloat(it.total) || (qty * unitPrice);
        return `
            <tr>
                <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${it.product_ref || '-'}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${it.product_name}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;text-align:center;">${qty} ${it.unit || ''}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;text-align:right;">${formatMoney(unitPrice)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#f97316;text-align:right;font-weight:600;">${formatMoney(lineTotal)}</td>
            </tr>
        `;
    }).join('');

    const moreItemsNote = items.length > 20
        ? `<p style="font-size:12px;color:#94a3b8;font-style:italic;">... et ${items.length - 20} autres lignes (voir PDF joint)</p>`
        : '';

    const htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
            <div style="border-bottom:3px solid #f97316;padding-bottom:16px;margin-bottom:24px;">
                <h1 style="color:#0b1120;font-size:22px;margin:0 0 6px;">Bon de commande ${po.po_number}</h1>
                <p style="color:#64748b;font-size:13px;margin:0;">Emis le ${issueDateFormatted}${expectedDateFormatted ? ' - Livraison souhaitee le ' + expectedDateFormatted : ''}</p>
            </div>

            <p style="font-size:14px;line-height:1.6;color:#334155;">Bonjour ${supplierName},</p>

            <p style="font-size:14px;line-height:1.6;color:#334155;">
                Veuillez trouver ci-dessous notre bon de commande. Le PDF complet est joint a cet email.
            </p>

            <h2 style="font-size:14px;color:#0b1120;margin-top:24px;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px;">Articles commandes</h2>

            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <thead>
                    <tr style="background:#f6f9fc;">
                        <th style="text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Ref.</th>
                        <th style="text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Designation</th>
                        <th style="text-align:center;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Qte</th>
                        <th style="text-align:right;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">P.U.</th>
                        <th style="text-align:right;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsTableRows}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4" style="padding:12px 8px;text-align:right;font-size:14px;font-weight:700;color:#0b1120;border-top:2px solid #0b1120;">TOTAL HT</td>
                        <td style="padding:12px 8px;text-align:right;font-size:16px;font-weight:800;color:#f97316;border-top:2px solid #0b1120;">${totalFormatted}</td>
                    </tr>
                </tfoot>
            </table>

            ${moreItemsNote}

            ${po.notes ? `
                <div style="background:#f6f9fc;border-left:3px solid #f97316;padding:12px 16px;margin-top:20px;border-radius:6px;">
                    <p style="font-size:12px;color:#64748b;margin:0 0 4px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Notes</p>
                    <p style="font-size:13px;color:#334155;margin:0;line-height:1.5;">${po.notes}</p>
                </div>
            ` : ''}

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 20px;">

            <p style="font-size:12px;color:#94a3b8;line-height:1.6;">
                Merci de confirmer la reception de ce bon de commande et de nous indiquer la date de livraison prevue.<br>
                Toute livraison doit etre accompagnee d'un bon de livraison mentionnant le numero <strong>${po.po_number}</strong>.
            </p>

            <p style="font-size:13px;color:#334155;margin-top:20px;">
                Cordialement,<br>
                <strong>${companyName}</strong>
                ${company.email ? '<br>' + company.email : ''}
                ${company.phone ? '<br>' + company.phone : ''}
            </p>
        </div>
    `;

    // Envoyer
    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Bon de commande <noreply@votreentreprise.com>';

    const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [recipientEmail],
        subject: 'Bon de commande ' + po.po_number + ' - ' + companyName,
        html: htmlContent,
        attachments: [{
            filename: 'BC_' + po.po_number + '.pdf',
            content: Buffer.from(pdfBytes).toString('base64'),
            contentType: 'application/pdf'
        }]
    });

    if (error) {
        throw new Error('Erreur Resend : ' + (error.message || 'inconnue'));
    }

    return {
        messageId: data?.id || null,
        sentTo: recipientEmail
    };
}

module.exports = { sendPurchaseOrderEmail };