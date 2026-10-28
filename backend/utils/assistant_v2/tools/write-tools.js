// backend/utils/assistant/tools/write-tools.js
// Outils d'ÉCRITURE — Chaque outil a 2 phases :
//   - prepare(args, userId) → génère un brouillon (preview)
//   - execute(args, userId) → exécution réelle (après confirmation)

const { pool } = require('../../../db');
const { ACTIONS } = require('../../assistant/actions'); // On réutilise tes actions existantes

// Mapping entre les noms d'outils V2 et les noms d'actions legacy
const ACTION_TYPE_MAP = {
    'create_quote_simple': 'create_quote_simple',
    'create_client': 'create_client',
    'create_product': 'create_product',
    'create_service': 'create_service',
    'create_supplier': 'create_supplier',
    'adjust_stock': 'adjust_stock',
    'update_quote': 'update_quote',
    'change_quote_status': 'change_quote_status',
    'delete_quote': 'delete_quote',
    'duplicate_quote': 'duplicate_quote',
    'convert_quote_to_invoice': 'convert_quote_to_invoice',
    'mark_invoice_paid': 'mark_invoice_paid',
    'send_quote_email': 'send_quote_email',
    'send_invoice_email': 'send_invoice_email',
    'add_items_to_quote': 'add_items_to_quote',
    'remove_item_from_quote': 'remove_item_from_quote',
    'save_preference': 'save_preference',
};

// async function executeLegacyAction(actionType, payload, userId) {
//     const legacyType = ACTION_TYPE_MAP[actionType] || actionType;
//     const action = ACTIONS[legacyType];
//     if (!action) throw new Error(`Action inconnue : ${actionType} (mappé vers ${legacyType})`);
//     return await action.execute(payload, userId);
// }

// ────────────────────────────────────────────────────────────
// WRAPPER : transforme une action legacy en outil V2
// ────────────────────────────────────────────────────────────
function wrapAction(actionKey) {
    const action = ACTIONS[actionKey];
    if (!action) throw new Error(`Action legacy inconnue : ${actionKey}`);

    return {
        async prepare(args, userId) {
            return await action.prepare(args, userId);
        },
        async execute(args, userId) {
            return await action.execute(args, userId);
        },
    };
}

// ────────────────────────────────────────────────────────────
// EXPOSITION DES ACTIONS
// ────────────────────────────────────────────────────────────
// Ces fonctions retournent un brouillon standardisé que l'Executor
// va transformer en "pendingAction" pour l'utilisateur.

async function createClient(userId, args) {
    const wrapped = wrapAction('create_client');
    return await wrapped.prepare(args, userId);
}

async function createProduct(userId, args) {
    const wrapped = wrapAction('create_product');
    return await wrapped.prepare(args, userId);
}

async function createService(userId, args) {
    const wrapped = wrapAction('create_service');
    return await wrapped.prepare(args, userId);
}

async function createSupplier(userId, args) {
    const wrapped = wrapAction('create_supplier');
    return await wrapped.prepare(args, userId);
}

async function adjustStock(userId, args) {
    const wrapped = wrapAction('adjust_stock');
    return await wrapped.prepare(args, userId);
}

async function createQuoteSimple(userId, args) {
    const wrapped = wrapAction('create_quote_simple');
    return await wrapped.prepare(args, userId);
}

async function updateQuote(userId, args) {
    const wrapped = wrapAction('update_quote');
    return await wrapped.prepare(args, userId);
}

async function changeQuoteStatus(userId, args) {
    const wrapped = wrapAction('change_quote_status');
    return await wrapped.prepare(args, userId);
}

async function deleteQuote(userId, args) {
    const wrapped = wrapAction('delete_quote');
    return await wrapped.prepare(args, userId);
}

async function duplicateQuote(userId, args) {
    const wrapped = wrapAction('duplicate_quote');
    return await wrapped.prepare(args, userId);
}

async function convertQuoteToInvoice(userId, args) {
    const wrapped = wrapAction('convert_quote_to_invoice');
    return await wrapped.prepare(args, userId);
}

async function markInvoicePaid(userId, args) {
    const wrapped = wrapAction('mark_invoice_paid');
    return await wrapped.prepare(args, userId);
}

async function sendQuoteEmail(userId, args) {
    const wrapped = wrapAction('send_quote_email');
    return await wrapped.prepare(args, userId);
}

async function sendInvoiceEmail(userId, args) {
    const wrapped = wrapAction('send_invoice_email');
    return await wrapped.prepare(args, userId);
}

async function addItemsToQuote(userId, args) {
    const wrapped = wrapAction('add_items_to_quote');
    return await wrapped.prepare(args, userId);
}

async function removeItemFromQuote(userId, args) {
    const wrapped = wrapAction('remove_item_from_quote');
    return await wrapped.prepare(args, userId);
}

async function savePreference(userId, args) {
    const wrapped = wrapAction('save_preference');
    return await wrapped.prepare(args, userId);
}

// ────────────────────────────────────────────────────────────
// EXÉCUTION — appelée après confirmation utilisateur
// ────────────────────────────────────────────────────────────
// async function executeLegacyAction(actionType, payload, userId) {
//     const action = ACTIONS[actionType];
//     if (!action) throw new Error(`Action inconnue : ${actionType}`);
//     return await action.execute(payload, userId);
// }

async function executeLegacyAction(actionType, payload, userId) {
    const legacyType = ACTION_TYPE_MAP[actionType] || actionType;
    const action = ACTIONS[legacyType];
    if (!action) throw new Error(`Action inconnue : ${actionType} (mappé vers ${legacyType})`);
    return await action.execute(payload, userId);
}

module.exports = {
    createClient,
    createProduct,
    createService,
    createSupplier,
    adjustStock,
    createQuoteSimple,
    updateQuote,
    changeQuoteStatus,
    deleteQuote,
    duplicateQuote,
    convertQuoteToInvoice,
    markInvoicePaid,
    sendQuoteEmail,
    sendInvoiceEmail,
    addItemsToQuote,
    removeItemFromQuote,
    savePreference,
    executeLegacyAction,
};