// backend/utils/peppol/storecove-client.js
// Client API Storecove pour l'envoi Peppol

const axios = require('axios');

const STORECOVE_BASE_URL = 'https://api.storecove.com/api/v2';

// ------------------------------------------------------------
// Envoie un document UBL à Storecove
// ------------------------------------------------------------
async function submitDocument(apiKey, { ublXml, senderLegalEntityId, receiverLegalEntityId, documentType = 'invoice' }) {
    try {
        const response = await axios.post(
            `${STORECOVE_BASE_URL}/document_submissions`,
            {
                legal_entity_id: senderLegalEntityId,
                document_type: documentType,
                document: Buffer.from(ublXml, 'utf-8').toString('base64'),
                sender_legal_entity_id: senderLegalEntityId,
                receiver_legal_entity_id: receiverLegalEntityId,
                routing: {
                    eidentifiers: [
                        {
                            scheme: 'iso6523-actorid-upis',
                            identifier: receiverLegalEntityId
                        }
                    ]
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            }
        );

        return {
            success: true,
            submissionId: response.data.id,
            guid: response.data.guid,
            status: response.data.status || 'submitted'
        };
    } catch (err) {
        const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message;
        console.error('Erreur Storecove submitDocument:', errorMessage);
        return {
            success: false,
            error: errorMessage,
            statusCode: err.response?.status
        };
    }
}

// ------------------------------------------------------------
// Récupère le statut d'une soumission
// ------------------------------------------------------------
async function getSubmissionStatus(apiKey, submissionId) {
    try {
        const response = await axios.get(
            `${STORECOVE_BASE_URL}/document_submissions/${submissionId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        return {
            success: true,
            status: response.data.status,
            deliveredAt: response.data.delivered_at,
            error: response.data.error
        };
    } catch (err) {
        const errorMessage = err.response?.data?.message || err.message;
        return {
            success: false,
            error: errorMessage
        };
    }
}

// ------------------------------------------------------------
// Vérifie qu'un participant est joignable sur Peppol
// ------------------------------------------------------------
async function lookupParticipant(apiKey, legalEntityId) {
    try {
        const response = await axios.get(
            `${STORECOVE_BASE_URL}/peppol/participants?identifier=${encodeURIComponent(legalEntityId)}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        return {
            success: true,
            exists: response.data.length > 0,
            participant: response.data[0] || null
        };
    } catch (err) {
        return {
            success: false,
            error: err.response?.data?.message || err.message
        };
    }
}

module.exports = {
    submitDocument,
    getSubmissionStatus,
    lookupParticipant
};