// backend/utils/peppol-billit.js
// ------------------------------------------------------------
// Client API Billit pour l'envoi de factures via Peppol
// Doc: https://docs.billit.be/docs/create-first-invoice
// ------------------------------------------------------------

const fetch = require('node-fetch');

function getConfig() {
    const baseUrl = process.env.BILLIT_BASE_URL || 'https://api.sandbox.billit.be';
    const partyId = process.env.BILLIT_PARTY_ID;
    const apiKey = process.env.BILLIT_API_KEY;

    if (!partyId || !apiKey) {
        throw new Error('BILLIT_PARTY_ID ou BILLIT_API_KEY manquant dans .env');
    }
    return { baseUrl, partyId, apiKey };
}

function getHeaders() {
    const { partyId, apiKey } = getConfig();
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'PartyID': String(partyId),
        'ApiKey': apiKey
    };
}

/**
 * Crée une facture dans Billit
 * Retourne l'OrderID (ID unique de la facture chez Billit)
 */
async function createInvoiceInBillit(invoiceData) {
    const { baseUrl } = getConfig();

    // Calcul de la TVA par ligne si non fourni
    const orderLines = invoiceData.items.map(item => {
        const vatPct = invoiceData.vatRegime === 'assujetti' ? (invoiceData.vatRate || 21) : 0;
        return {
            Quantity: parseFloat(item.qty) || 1,
            UnitPriceExcl: parseFloat(item.unitPrice) || 0,
            Description: item.name || 'Article',
            VATPercentage: vatPct
        };
    });

    const body = {
        OrderType: 'Invoice',
        OrderDirection: 'Income',
        OrderNumber: invoiceData.invoiceNumber,
        OrderDate: invoiceData.issueDate,
        ExpiryDate: invoiceData.dueDate,
        Customer: {
            Name: invoiceData.clientName || 'Client',
            VATNumber: invoiceData.clientVat || undefined,
            PartyType: 'Customer',
            Email: invoiceData.clientEmail || undefined
        },
        OrderLines: orderLines,
        Currency: 'EUR'
    };

    // Ajouter les coordonnées bancaires si dispo
    if (invoiceData.companyIban) {
        body.PaymentReference = invoiceData.invoiceNumber;
    }

    console.log('📤 Envoi facture à Billit...');
    const response = await fetch(`${baseUrl}/v1/orders`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('❌ Erreur Billit:', response.status, errText);
        throw new Error(`Billit API error ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const orderId = result.OrderID || result.orderID || result.id;
    if (!orderId) {
        throw new Error('Billit n\'a pas retourné d\'OrderID');
    }

    console.log(`✅ Facture créée chez Billit : OrderID = ${orderId}`);
    return orderId;
}

/**
 * Envoie une ou plusieurs factures via Peppol
 * @param {number|number[]} orderIds - Un ID ou un tableau d'IDs Billit
 */
async function sendViaPeppol(orderIds) {
    const { baseUrl } = getConfig();
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];

    const body = {
        TransportType: 'Peppol',
        OrderIDs: ids
    };

    console.log(`📨 Envoi Peppol pour les factures: ${ids.join(', ')}`);
    const response = await fetch(`${baseUrl}/v1/orders/commands/send`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('❌ Erreur envoi Peppol:', response.status, errText);
        throw new Error(`Peppol send error ${response.status}: ${errText}`);
    }

    console.log('✅ Envoi Peppol lancé');
    return true;
}

/**
 * Récupère le statut d'une facture chez Billit
 */
async function getInvoiceStatus(orderId) {
    const { baseUrl } = getConfig();
    const response = await fetch(`${baseUrl}/v1/orders/${orderId}`, {
        method: 'GET',
        headers: getHeaders()
    });

    if (!response.ok) {
        throw new Error(`Erreur récupération statut: ${response.status}`);
    }

    const data = await response.json();
    return {
        delivered: data.CurrentDocumentDeliveryDetails?.IsDocumentDelivered || false,
        status: data.CurrentDocumentDeliveryDetails?.DocumentDeliveryStatus || 'unknown',
        date: data.CurrentDocumentDeliveryDetails?.DocumentDeliveryDate,
        info: data.CurrentDocumentDeliveryDetails?.DocumentDeliveryInfo || ''
    };
}

module.exports = {
    createInvoiceInBillit,
    sendViaPeppol,
    getInvoiceStatus
};