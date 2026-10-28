// backend/utils/assistant/tools/registry.js
// Catalogue unique de TOUS les outils disponibles pour l'assistant V2.

const readTools = require('./read-tools');
const writeTools = require('./write-tools');
const computeTools = require('./compute-tools');

// ────────────────────────────────────────────────────────────
// DÉFINITION DES OUTILS
// ────────────────────────────────────────────────────────────
const TOOLS = {

    // ═══════════════════════════════════════════════════════════
    // LECTURE
    // ═══════════════════════════════════════════════════════════
    list_products: {
        description: 'Liste les produits du catalogue',
        category: 'read',
        critical: false,
        schema: { search: 'string?', limit: 'number?' },
        async run(args, userId) { return await readTools.listProducts(userId, args); },
    },
    find_product: {
        description: 'Cherche un produit par nom, référence ou catégorie',
        category: 'read',
        critical: false,
        schema: { query: 'string' },
        async run(args, userId) { return await readTools.findProduct(userId, args); },
    },
    list_services: {
        description: 'Liste les services et main d\'œuvre',
        category: 'read',
        critical: false,
        schema: { limit: 'number?' },
        async run(args, userId) { return await readTools.listServices(userId, args); },
    },
    list_clients: {
        description: 'Liste tous les clients',
        category: 'read',
        critical: false,
        schema: { limit: 'number?' },
        async run(args, userId) { return await readTools.listClients(userId, args); },
    },
    find_client: {
        description: 'Cherche un client par nom, email ou contact',
        category: 'read',
        critical: false,
        schema: { query: 'string' },
        async run(args, userId) { return await readTools.findClient(userId, args); },
    },
    list_suppliers: {
        description: 'Liste les fournisseurs',
        category: 'read',
        critical: false,
        schema: { limit: 'number?' },
        async run(args, userId) { return await readTools.listSuppliers(userId, args); },
    },
    list_quotes: {
        description: 'Liste les devis (filtrable par statut : draft, sent, accepted, refused)',
        category: 'read',
        critical: false,
        schema: { status: 'string?', limit: 'number?' },
        async run(args, userId) { return await readTools.listQuotes(userId, args); },
    },
    find_quote: {
        description: 'Trouve un devis précis (par id, numéro, ou référence relative : "dernier", "premier", "3")',
        category: 'read',
        critical: false,
        schema: { quoteId: 'number?', quoteNumber: 'string?', quoteRef: 'string?' },
        async run(args, userId) { return await readTools.findQuote(userId, args); },
    },
    quote_stats: {
        description: 'Statistiques des devis (nombre, montants, taux de conversion)',
        category: 'read',
        critical: false,
        schema: {},
        async run(args, userId) { return await readTools.getQuoteStats(userId); },
    },
    list_invoices: {
        description: 'Liste les factures (filtrable par statut : draft, sent, paid, overdue)',
        category: 'read',
        critical: false,
        schema: { status: 'string?', limit: 'number?' },
        async run(args, userId) { return await readTools.listInvoices(userId, args); },
    },
    invoice_stats: {
        description: 'Statistiques des factures (payées, en attente, en retard)',
        category: 'read',
        critical: false,
        schema: {},
        async run(args, userId) { return await readTools.getInvoiceStats(userId); },
    },
    stock_alerts: {
        description: 'Produits dont le stock est sous le seuil d\'alerte',
        category: 'read',
        critical: false,
        schema: {},
        async run(args, userId) { return await readTools.getStockAlerts(userId); },
    },
    list_chantiers: {
        description: 'Liste les chantiers',
        category: 'read',
        critical: false,
        schema: { status: 'string?', limit: 'number?' },
        async run(args, userId) { return await readTools.listChantiers(userId, args); },
    },
    find_chantier: {
        description: 'Cherche un chantier par nom ou client',
        category: 'read',
        critical: false,
        schema: { query: 'string' },
        async run(args, userId) { return await readTools.findChantier(userId, args); },
    },
    chantier_stats: {
        description: 'Statistiques des chantiers (en cours, terminés, budget)',
        category: 'read',
        critical: false,
        schema: {},
        async run(args, userId) { return await readTools.getChantierStats(userId); },
    },
    general_stats: {
        description: 'Vue d\'ensemble : nombre de produits, clients, devis, factures, chantiers',
        category: 'read',
        critical: false,
        schema: {},
        async run(args, userId) { return await readTools.getGeneralStats(userId); },
    },

    // ═══════════════════════════════════════════════════════════
    // CALCUL
    // ═══════════════════════════════════════════════════════════
    calculate_quote: {
        description: 'Calcule les lignes d\'un devis à partir d\'une description métier (ex: "peindre 3 murs de 3m x 2.5m")',
        category: 'compute',
        critical: false,
        schema: { description: 'string' },
        async run(args, userId, context) { return await computeTools.calculateAuto(userId, args, context); },
    },
    detect_metier: {
        description: 'Détecte le métier mentionné dans un texte',
        category: 'compute',
        critical: false,
        schema: { description: 'string' },
        async run(args, userId) { return await computeTools.detectMetier(userId, args); },
    },

    // ═══════════════════════════════════════════════════════════
    // ÉCRITURE (toutes critiques → confirmation utilisateur)
    // ═══════════════════════════════════════════════════════════
    create_client: {
        description: 'Crée un nouveau client (nécessite confirmation)',
        category: 'write',
        critical: true,
        schema: { name: 'string', contactName: 'string?', email: 'string?', phone: 'string?', address: 'string?', vatNumber: 'string?' },
        async run(args, userId) { return await writeTools.createClient(userId, args); },
    },
    create_product: {
        description: 'Crée un nouveau produit (nécessite confirmation)',
        category: 'write',
        critical: true,
        schema: { name: 'string', unitPrice: 'number', ref: 'string?', unit: 'string?', category: 'string?' },
        async run(args, userId) { return await writeTools.createProduct(userId, args); },
    },
    create_service: {
        description: 'Crée un nouveau service (nécessite confirmation)',
        category: 'write',
        critical: true,
        schema: { name: 'string', unitPrice: 'number', unit: 'string?', isLabor: 'boolean?' },
        async run(args, userId) { return await writeTools.createService(userId, args); },
    },
    create_supplier: {
        description: 'Crée un nouveau fournisseur',
        category: 'write',
        critical: true,
        schema: { name: 'string', contactName: 'string?', email: 'string?', phone: 'string?' },
        async run(args, userId) { return await writeTools.createSupplier(userId, args); },
    },
    adjust_stock: {
        description: 'Ajuste le stock d\'un produit (in/out/adjustment)',
        category: 'write',
        critical: true,
        schema: { productRef: 'string?', productName: 'string?', quantity: 'number', movementType: 'in|out|adjustment?', reason: 'string?' },
        async run(args, userId) { return await writeTools.adjustStock(userId, args); },
    },
    create_quote: {
        description: 'Crée un nouveau devis (nécessite confirmation)',
        category: 'write',
        critical: true,
        schema: { clientName: 'string', items: 'array', vatRegime: 'string?', vatRate: 'number?' },
        async run(args, userId) { return await writeTools.createQuoteSimple(userId, args); },
    },
    update_quote: {
        description: 'Modifie un devis existant (client, adresse, email, statut, date)',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?', clientName: 'string?', clientAddress: 'string?', clientEmail: 'string?', clientVat: 'string?', status: 'string?', validDate: 'string?', vatRegime: 'string?' },
        async run(args, userId) {
            // Adapter pour la logique legacy (patch)
            const patch = {};
            for (const k of ['clientName', 'clientAddress', 'clientEmail', 'clientVat', 'status', 'validDate', 'vatRegime']) {
                if (args[k] !== undefined) patch[k] = args[k];
            }
            return await writeTools.updateQuote(userId, { quoteId: args.quoteId, quoteRef: args.quoteRef, patch });
        },
    },
    change_quote_status: {
        description: 'Change le statut d\'un devis (draft, sent, accepted, refused)',
        category: 'write',
        critical: true,
        schema: { status: 'string', quoteId: 'number?', quoteRef: 'string?' },
        async run(args, userId) { return await writeTools.changeQuoteStatus(userId, args); },
    },
    delete_quote: {
        description: 'Supprime un devis (IRRÉVERSIBLE)',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?' },
        async run(args, userId) { return await writeTools.deleteQuote(userId, args); },
    },
    duplicate_quote: {
        description: 'Duplique un devis existant en nouveau brouillon',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?' },
        async run(args, userId) { return await writeTools.duplicateQuote(userId, args); },
    },
    convert_quote_to_invoice: {
        description: 'Transforme un devis en facture brouillon',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?' },
        async run(args, userId) { return await writeTools.convertQuoteToInvoice(userId, args); },
    },
    mark_invoice_paid: {
        description: 'Marque une facture comme payée',
        category: 'write',
        critical: true,
        schema: { invoiceId: 'number?', invoiceNumber: 'string?', paymentMethod: 'string?' },
        async run(args, userId) { return await writeTools.markInvoicePaid(userId, args); },
    },
    send_quote_email: {
        description: 'Envoie un devis par email (nécessite email valide)',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?', email: 'string?' },
        async run(args, userId) { return await writeTools.sendQuoteEmail(userId, args); },
    },
    send_invoice_email: {
        description: 'Envoie une facture par email',
        category: 'write',
        critical: true,
        schema: { invoiceId: 'number?', invoiceNumber: 'string?', email: 'string?' },
        async run(args, userId) { return await writeTools.sendInvoiceEmail(userId, args); },
    },
    add_items_to_quote: {
        description: 'Ajoute des lignes à un devis existant',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?', items: 'array' },
        async run(args, userId) { return await writeTools.addItemsToQuote(userId, args); },
    },
    remove_item_from_quote: {
        description: 'Retire une ligne d\'un devis',
        category: 'write',
        critical: true,
        schema: { quoteId: 'number?', quoteRef: 'string?', itemRef: 'string?', itemName: 'string?' },
        async run(args, userId) { return await writeTools.removeItemFromQuote(userId, args); },
    },
    save_preference: {
        description: 'Sauvegarde une préférence utilisateur (taux horaire, marge, TVA, conditions de paiement)',
        category: 'write',
        critical: false,
        schema: { preference: 'string', value: 'string' },
        async run(args, userId) { return await writeTools.savePreference(userId, args); },
    },
};

// ────────────────────────────────────────────────────────────
// CATALOGUE TEXTE pour le Planner
// ────────────────────────────────────────────────────────────
function buildToolsCatalog() {
    const lines = [];
    for (const [name, tool] of Object.entries(TOOLS)) {
        const schemaStr = Object.entries(tool.schema)
            .map(([k, v]) => `${k}:${v}`)
            .join(', ');
        const criticalTag = tool.critical ? ' [CRITIQUE]' : '';
        lines.push(`- ${name}${criticalTag} : ${tool.description} | args: {${schemaStr}}`);
    }
    return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// EXÉCUTION
// ────────────────────────────────────────────────────────────
async function runTool(toolName, args, userId, context = {}) {
    const tool = TOOLS[toolName];
    if (!tool) throw new Error(`Outil inconnu : ${toolName}`);
    return await tool.run(args || {}, userId, context);
}

function getTool(toolName) {
    return TOOLS[toolName] || null;
}

function getToolNames() {
    return Object.keys(TOOLS);
}

module.exports = {
    TOOLS,
    buildToolsCatalog,
    runTool,
    getTool,
    getToolNames,
};