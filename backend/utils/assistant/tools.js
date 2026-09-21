// backend/utils/assistant/tools.js
// Outils de lecture disponibles pour l'assistant IA

const { pool } = require('../../db');

// ------------------------------------------------------------
// PRODUITS
// ------------------------------------------------------------
async function listProducts(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 50, 200);
    const search = args.search ? `%${args.search.toLowerCase()}%` : null;

    let query = `SELECT ref, name, unit_price, unit, category, stock_quantity, track_stock
                 FROM products WHERE user_id = $1`;
    const params = [userId];
    if (search) {
        params.push(search);
        query += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(ref) LIKE $${params.length})`;
    }
    query += ` ORDER BY name ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return {
        count: result.rows.length,
        products: result.rows.map(p => ({
            ref: p.ref,
            name: p.name,
            price: parseFloat(p.unit_price),
            unit: p.unit,
            category: p.category,
            stock: p.track_stock ? parseFloat(p.stock_quantity) : null
        }))
    };
}

async function findProduct(userId, args) {
    if (!args.query) return { error: 'Aucun terme de recherche fourni' };
    const term = `%${args.query.toLowerCase()}%`;
    const result = await pool.query(`
        SELECT ref, name, unit_price, unit, category, description, stock_quantity, track_stock
        FROM products WHERE user_id = $1
          AND (LOWER(name) LIKE $2 OR LOWER(ref) LIKE $2 OR LOWER(category) LIKE $2)
        ORDER BY name ASC LIMIT 10
    `, [userId, term]);
    return {
        count: result.rows.length,
        matches: result.rows.map(p => ({
            ref: p.ref,
            name: p.name,
            price: parseFloat(p.unit_price),
            unit: p.unit,
            category: p.category,
            stock: p.track_stock ? parseFloat(p.stock_quantity) : null
        }))
    };
}

// ------------------------------------------------------------
// SERVICES
// ------------------------------------------------------------
async function listServices(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 50, 200);
    const result = await pool.query(`
        SELECT ref, name, unit_price, unit, category, is_labor
        FROM services WHERE user_id = $1 AND active = TRUE
        ORDER BY is_labor DESC, name ASC LIMIT $2
    `, [userId, limit]);
    return {
        count: result.rows.length,
        services: result.rows.map(s => ({
            ref: s.ref,
            name: s.name,
            price: parseFloat(s.unit_price),
            unit: s.unit,
            category: s.category,
            isLabor: s.is_labor
        }))
    };
}

// ------------------------------------------------------------
// CLIENTS
// ------------------------------------------------------------
async function listClients(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 50, 200);
    const result = await pool.query(`
        SELECT id, name, contact_name, email, phone, address, vat_number
        FROM clients WHERE user_id = $1 ORDER BY name ASC LIMIT $2
    `, [userId, limit]);
    return {
        count: result.rows.length,
        clients: result.rows.map(c => ({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            vat: c.vat_number
        }))
    };
}

async function findClient(userId, args) {
    if (!args.query) return { error: 'Aucun terme de recherche fourni' };
    const term = `%${args.query.toLowerCase()}%`;
    const result = await pool.query(`
        SELECT id, name, contact_name, email, phone, address, vat_number, notes
        FROM clients WHERE user_id = $1
          AND (LOWER(name) LIKE $2 OR LOWER(email) LIKE $2 OR LOWER(contact_name) LIKE $2)
        ORDER BY name ASC LIMIT 10
    `, [userId, term]);
    return {
        count: result.rows.length,
        matches: result.rows.map(c => ({
            id: c.id,
            name: c.name,
            contactName: c.contact_name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vat: c.vat_number,
            notes: c.notes
        }))
    };
}

// ------------------------------------------------------------
// FOURNISSEURS
// ------------------------------------------------------------
async function listSuppliers(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 50, 200);
    const result = await pool.query(`
        SELECT id, name, contact_name, email, phone, category, delivery_days
        FROM suppliers WHERE user_id = $1 AND active = TRUE
        ORDER BY name ASC LIMIT $2
    `, [userId, limit]);
    return {
        count: result.rows.length,
        suppliers: result.rows.map(s => ({
            id: s.id,
            name: s.name,
            contactName: s.contact_name,
            email: s.email,
            phone: s.phone,
            category: s.category,
            deliveryDays: s.delivery_days
        }))
    };
}

// ------------------------------------------------------------
// DEVIS
// ------------------------------------------------------------
async function listQuotes(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 20, 100);
    const status = args.status || null;

    let query = `SELECT id, quote_number, issue_date, valid_date, total, status, client_name
                 FROM quotes WHERE user_id = $1`;
    const params = [userId];
    if (status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return {
        count: result.rows.length,
        quotes: result.rows.map(q => ({
            id: q.id,
            number: q.quote_number,
            issueDate: q.issue_date,
            validDate: q.valid_date,
            total: parseFloat(q.total),
            status: q.status,
            client: q.client_name
        }))
    };
}

async function getQuoteStats(userId) {
    const result = await pool.query(`
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'draft') as draft,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
            COUNT(*) FILTER (WHERE status = 'refused') as refused,
            COALESCE(SUM(total), 0) as total_amount,
            COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) as accepted_amount
        FROM quotes WHERE user_id = $1
    `, [userId]);
    const r = result.rows[0];
    return {
        totalQuotes: parseInt(r.total),
        draft: parseInt(r.draft),
        sent: parseInt(r.sent),
        accepted: parseInt(r.accepted),
        refused: parseInt(r.refused),
        totalAmount: parseFloat(r.total_amount),
        acceptedAmount: parseFloat(r.accepted_amount),
        conversionRate: parseInt(r.total) > 0 ? Math.round((parseInt(r.accepted) / parseInt(r.total)) * 100) : 0
    };
}

// ------------------------------------------------------------
// FACTURES
// ------------------------------------------------------------
async function listInvoices(userId, args = {}) {
    const limit = Math.min(parseInt(args.limit) || 20, 100);
    const status = args.status || null;

    let query = `SELECT id, invoice_number, issue_date, due_date, total, status, client_name
                 FROM invoices WHERE user_id = $1`;
    const params = [userId];
    if (status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return {
        count: result.rows.length,
        invoices: result.rows.map(i => ({
            id: i.id,
            number: i.invoice_number,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            total: parseFloat(i.total),
            status: i.status,
            client: i.client_name
        }))
    };
}

async function getInvoiceStats(userId) {
    const result = await pool.query(`
        SELECT
            COUNT(*) as total,
            COALESCE(SUM(total), 0) as total_amount,
            COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) as paid_amount,
            COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0) as pending_amount,
            COALESCE(SUM(total) FILTER (WHERE status = 'overdue'), 0) as overdue_amount
        FROM invoices WHERE user_id = $1
    `, [userId]);
    const r = result.rows[0];
    return {
        totalInvoices: parseInt(r.total),
        totalAmount: parseFloat(r.total_amount),
        paidAmount: parseFloat(r.paid_amount),
        pendingAmount: parseFloat(r.pending_amount),
        overdueAmount: parseFloat(r.overdue_amount)
    };
}

// ------------------------------------------------------------
// STOCK
// ------------------------------------------------------------
async function getStockAlerts(userId) {
    const result = await pool.query(`
        SELECT p.ref, p.name, p.stock_quantity, p.stock_alert_threshold,
               p.unit, s.name as supplier_name
        FROM products p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.user_id = $1 AND p.track_stock = TRUE
          AND p.stock_quantity <= p.stock_alert_threshold
        ORDER BY (p.stock_quantity - p.stock_alert_threshold) ASC
    `, [userId]);
    return {
        count: result.rows.length,
        alerts: result.rows.map(a => ({
            ref: a.ref,
            name: a.name,
            stock: parseFloat(a.stock_quantity),
            threshold: parseFloat(a.stock_alert_threshold),
            unit: a.unit,
            supplier: a.supplier_name
        }))
    };
}

// ------------------------------------------------------------
// STATS GÉNÉRALES
// ------------------------------------------------------------
async function getGeneralStats(userId) {
    const [products, clients, services, suppliers, quoteStats, invoiceStats] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM products WHERE user_id = $1', [userId]),
        pool.query('SELECT COUNT(*) FROM clients WHERE user_id = $1', [userId]),
        pool.query('SELECT COUNT(*) FROM services WHERE user_id = $1 AND active = TRUE', [userId]),
        pool.query('SELECT COUNT(*) FROM suppliers WHERE user_id = $1 AND active = TRUE', [userId]),
        getQuoteStats(userId),
        getInvoiceStats(userId)
    ]);
    return {
        products: parseInt(products.rows[0].count),
        clients: parseInt(clients.rows[0].count),
        services: parseInt(services.rows[0].count),
        suppliers: parseInt(suppliers.rows[0].count),
        quotes: quoteStats,
        invoices: invoiceStats
    };
}

module.exports = {
    listProducts,
    findProduct,
    listServices,
    listClients,
    findClient,
    listSuppliers,
    listQuotes,
    getQuoteStats,
    listInvoices,
    getInvoiceStats,
    getStockAlerts,
    getGeneralStats
};