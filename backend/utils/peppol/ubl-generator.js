// backend/utils/peppol/ubl-generator.js
// Génère un fichier UBL 2.1 conforme Peppol BIS 3.0

const { pool } = require('../../db');

// ------------------------------------------------------------
// Échappe les caractères spéciaux XML
// ------------------------------------------------------------
function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ------------------------------------------------------------
// Formate une date au format YYYY-MM-DD
// ------------------------------------------------------------
function formatDate(date) {
    if (!date) return new Date().toISOString().slice(0, 10);
    if (typeof date === 'string') return date.slice(0, 10);
    return new Date(date).toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Nettoie un numéro de TVA (retire les espaces, points, tirets)
// ------------------------------------------------------------
function cleanVatNumber(vat) {
    if (!vat) return '';
    return String(vat).replace(/[\s.\-]/g, '').toUpperCase();
}

// ------------------------------------------------------------
// Génère le XML UBL d'une facture
// ------------------------------------------------------------
async function generateUBL(invoice, settings, client) {
    // Charger les items de la facture
    const items = Array.isArray(invoice.items) ? invoice.items : [];

    const issueDate = formatDate(invoice.issue_date);
    const dueDate = formatDate(invoice.due_date);
    const invoiceNumber = invoice.invoice_number || `FAC-${invoice.id}`;

    // Données vendeur (settings)
    const sellerName = settings.company_name || 'Vendeur';
    const sellerVat = cleanVatNumber(settings.tva);
    const sellerAddress = settings.address || '';
    const sellerCity = extractCity(sellerAddress);
    const sellerPostal = extractPostalCode(sellerAddress);

    // Données acheteur (client)
    const buyerName = client?.name || invoice.client_name || 'Client';
    const buyerVat = cleanVatNumber(client?.vat_number || invoice.client_vat);
    const buyerAddress = client?.address || invoice.client_address || '';
    const buyerCity = extractCity(buyerAddress);
    const buyerPostal = extractPostalCode(buyerAddress);
    const buyerEmail = client?.email || invoice.client_email || '';

    // Identifiants Peppol (scheme 0208 = Belgique)
    const sellerScheme = settings.peppol_scheme_id || '0208';
    const buyerScheme = '0208'; // À adapter selon le pays du client

    // Calcul des totaux
    const subtotal = parseFloat(invoice.subtotal) || 0;
    const vatAmount = parseFloat(invoice.vat_amount) || 0;
    const total = parseFloat(invoice.total) || 0;
    const vatRate = parseFloat(settings.vat_rate) || 21;
    const vatRegime = settings.vat_regime || 'franchise';

    // Lignes de la facture
    const invoiceLines = items.map((item, idx) => {
        const qty = parseFloat(item.qty) || 1;
        const unitPrice = parseFloat(item.unitPrice || item.unit_price) || 0;
        const lineTotal = qty * unitPrice;
        const itemVatAmount = vatRegime === 'assujetti' ? lineTotal * (vatRate / 100) : 0;
        const itemTotalWithVat = lineTotal + itemVatAmount;

        return `
    <cac:InvoiceLine>
        <cbc:ID>${idx + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="EUR">${lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Name>${escapeXml(item.name || 'Article')}</cbc:Name>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="EUR">${unitPrice.toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="EUR">${itemVatAmount.toFixed(2)}</cbc:TaxAmount>
            <cac:TaxSubtotal>
                <cbc:TaxableAmount currencyID="EUR">${lineTotal.toFixed(2)}</cbc:TaxableAmount>
                <cbc:TaxAmount currencyID="EUR">${itemVatAmount.toFixed(2)}</cbc:TaxAmount>
                <cac:TaxCategory>
                    <cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">${vatRegime === 'assujetti' ? 'S' : 'Z'}</cbc:ID>
                    <cbc:Percent>${vatRegime === 'assujetti' ? vatRate : 0}</cbc:Percent>
                    <cac:TaxScheme>
                        <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">VAT</cbc:ID>
                    </cac:TaxScheme>
                </cac:TaxCategory>
            </cac:TaxSubtotal>
        </cac:TaxTotal>
    </cac:InvoiceLine>`;
    }).join('');

    // XML UBL complet
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
    <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
    <cbc:ID>${escapeXml(invoiceNumber)}</cbc:ID>
    <cbc:IssueDate>${issueDate}</cbc:IssueDate>
    <cbc:DueDate>${dueDate}</cbc:DueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
    
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cbc:EndpointID schemeID="${sellerScheme}">${sellerVat}</cbc:EndpointID>
            <cac:PartyName>
                <cbc:Name>${escapeXml(sellerName)}</cbc:Name>
            </cac:PartyName>
            <cac:PostalAddress>
                <cbc:StreetName>${escapeXml(sellerAddress)}</cbc:StreetName>
                <cbc:CityName>${escapeXml(sellerCity)}</cbc:CityName>
                <cbc:PostalZone>${escapeXml(sellerPostal)}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>BE</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${sellerVat}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(sellerName)}</cbc:RegistrationName>
                <cbc:CompanyID>${escapeXml(settings.siret || sellerVat)}</cbc:CompanyID>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
    
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cbc:EndpointID schemeID="${buyerScheme}">${buyerVat || 'N/A'}</cbc:EndpointID>
            <cac:PartyName>
                <cbc:Name>${escapeXml(buyerName)}</cbc:Name>
            </cac:PartyName>
            <cac:PostalAddress>
                <cbc:StreetName>${escapeXml(buyerAddress)}</cbc:StreetName>
                <cbc:CityName>${escapeXml(buyerCity)}</cbc:CityName>
                <cbc:PostalZone>${escapeXml(buyerPostal)}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>BE</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            ${buyerVat ? `
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${buyerVat}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>` : ''}
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(buyerName)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
        <cbc:PaymentDueDate>${dueDate}</cbc:PaymentDueDate>
        ${settings.iban ? `
        <cac:PayeeFinancialAccount>
            <cbc:ID>${escapeXml(settings.iban)}</cbc:ID>
            ${settings.bank_name ? `<cbc:Name>${escapeXml(settings.bank_name)}</cbc:Name>` : ''}
        </cac:PayeeFinancialAccount>` : ''}
    </cac:PaymentMeans>
    
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="EUR">${vatAmount.toFixed(2)}</cbc:TaxAmount>
    </cac:TaxTotal>
    
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="EUR">${subtotal.toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="EUR">${subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="EUR">${total.toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="EUR">${total.toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    
    ${invoiceLines}
</Invoice>`;

    return xml;
}

// ------------------------------------------------------------
// Extrait la ville d'une adresse (heuristique simple)
// ------------------------------------------------------------
function extractCity(address) {
    if (!address) return '';
    // Format typique : "Rue X 12, 1000 Bruxelles"
    const match = address.match(/\d{4,5}\s+([A-ZÀ-Ü][a-zà-ü\s-]+)/);
    if (match) return match[1].trim();
    return address.slice(0, 50);
}

// ------------------------------------------------------------
// Extrait le code postal d'une adresse
// ------------------------------------------------------------
function extractPostalCode(address) {
    if (!address) return '';
    const match = address.match(/\b(\d{4,5})\b/);
    return match ? match[1] : '';
}

module.exports = {
    generateUBL,
    escapeXml,
    cleanVatNumber
};