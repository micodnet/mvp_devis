// backend/utils/demo/seed.js
// Peuplement d'un compte demo avec des donnees realistes

const { pool } = require('../../db');

async function seedDemoData(userId, companyName) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Settings de l'entreprise demo
        await client.query(`
            INSERT INTO settings (
                user_id, company_name, address, siret, tva, phone, email, website,
                vat_regime, vat_rate, invoice_prefix, payment_terms, language
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (user_id) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                address = EXCLUDED.address,
                siret = EXCLUDED.siret,
                tva = EXCLUDED.tva,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                website = EXCLUDED.website,
                vat_regime = EXCLUDED.vat_regime,
                vat_rate = EXCLUDED.vat_rate,
                invoice_prefix = EXCLUDED.invoice_prefix,
                payment_terms = EXCLUDED.payment_terms,
                language = EXCLUDED.language
        `, [
            userId,
            companyName || 'Demo Construction SA',
            '12 rue de la Demo, 1000 Bruxelles',
            '0123456789',
            'BE0123456789',
            '+32 2 123 45 67',
            'demo@devis-express.be',
            'https://demo.devis-express.be',
            'assujetti',
            21,
            'FAC',
            30,
            'fr'
        ]);

        // 2. Clients
        const clientsData = [
            { name: 'Vincent Dubois', contact: 'Vincent Dubois', email: 'vincent.dubois@example.be', phone: '+32 475 12 34 56', address: '45 avenue Louise, 1050 Bruxelles', vat: 'BE0987654321' },
            { name: 'Martin SA', contact: 'Sophie Martin', email: 'contact@martin-sa.be', phone: '+32 2 345 67 89', address: '78 chaussee de Waterloo, 1180 Uccle', vat: 'BE0456789123' },
            { name: 'Leroy Immobilier', contact: 'Marc Leroy', email: 'marc@leroy-immo.be', phone: '+32 495 98 76 54', address: '12 rue du Marche, 4000 Liege', vat: 'BE0789456123' },
            { name: 'Dupont & Fils', contact: 'Pierre Dupont', email: 'info@dupont-fils.be', phone: '+32 4 123 45 67', address: '5 place Saint-Lambert, 4000 Liege', vat: 'BE0345678912' },
            { name: 'Restaurant Le Gourmet', contact: 'Chef Bernard', email: 'resa@legourmet.be', phone: '+32 2 987 65 43', address: '89 rue Antoine Dansaert, 1000 Bruxelles', vat: 'BE0678912345' }
        ];

        const clientIds = [];
        for (const c of clientsData) {
            const r = await client.query(`
                INSERT INTO clients (user_id, name, contact_name, email, phone, address, vat_number)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [userId, c.name, c.contact, c.email, c.phone, c.address, c.vat]);
            clientIds.push(r.rows[0].id);
        }

        // 3. Produits
        const productsData = [
            { ref: 'PEINT-001', name: 'Peinture acrylique blanche mate 5L', unit: 'pot', price: 45, category: 'Peinture', stock: 25, threshold: 5 },
            { ref: 'PEINT-002', name: 'Peinture acrylique couleur 5L', unit: 'pot', price: 52, category: 'Peinture', stock: 18, threshold: 5 },
            { ref: 'PLACO-001', name: 'Plaque de platre BA13 2.5x1.2m', unit: 'piece', price: 8.50, category: 'Placo', stock: 120, threshold: 30 },
            { ref: 'PLACO-002', name: 'Montant metallique 48mm 3m', unit: 'piece', price: 4.20, category: 'Placo', stock: 85, threshold: 20 },
            { ref: 'PLACO-003', name: 'Rail metallique 48mm 3m', unit: 'piece', price: 4.50, category: 'Placo', stock: 60, threshold: 15 },
            { ref: 'PLACO-004', name: 'Laine de verre 100mm 10m2', unit: 'rouleau', price: 32, category: 'Isolation', stock: 22, threshold: 8 },
            { ref: 'PLACO-005', name: 'Vis TTPC 25mm boite 1000', unit: 'boite', price: 12, category: 'Placo', stock: 15, threshold: 5 },
            { ref: 'CARR-001', name: 'Carrelage sol gres cerame 60x60', unit: 'm2', price: 25, category: 'Carrelage', stock: 45, threshold: 15 },
            { ref: 'CARR-002', name: 'Colle carrelage 25kg', unit: 'sac', price: 14, category: 'Carrelage', stock: 30, threshold: 10 },
            { ref: 'CARR-003', name: 'Joint carrelage 5kg', unit: 'sac', price: 8, category: 'Carrelage', stock: 25, threshold: 8 },
            { ref: 'PARQ-001', name: 'Parquet chene massif 14mm', unit: 'm2', price: 42, category: 'Parquet', stock: 80, threshold: 25 },
            { ref: 'PARQ-002', name: 'Sous-couche isolante 10m2', unit: 'rouleau', price: 18, category: 'Parquet', stock: 15, threshold: 5 },
            { ref: 'ELEC-001', name: 'Prise encastree complete', unit: 'piece', price: 12, category: 'Electricite', stock: 100, threshold: 25 },
            { ref: 'ELEC-002', name: 'Interrupteur va-et-vient', unit: 'piece', price: 15, category: 'Electricite', stock: 80, threshold: 20 },
            { ref: 'PLOMB-001', name: 'WC complet suspendu', unit: 'piece', price: 280, category: 'Plomberie', stock: 8, threshold: 3 },
            { ref: 'PLOMB-002', name: 'Lavabo + robinetterie', unit: 'piece', price: 180, category: 'Plomberie', stock: 12, threshold: 4 }
        ];

        const productIds = [];
        for (const p of productsData) {
            const r = await client.query(`
                INSERT INTO products (
                    user_id, ref, name, unit, unit_price, category,
                    track_stock, stock_quantity, stock_alert_threshold
                )
                VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
                RETURNING id
            `, [userId, p.ref, p.name, p.unit, p.price, p.category, p.stock, p.threshold]);
            productIds.push(r.rows[0].id);
        }

        // 4. Services
        const servicesData = [
            { ref: 'MO-PEINT', name: 'Main d oeuvre peinture', unit: 'h', price: 45, isLabor: true },
            { ref: 'MO-PLACO', name: 'Main d oeuvre placo', unit: 'h', price: 48, isLabor: true },
            { ref: 'MO-CARR', name: 'Main d oeuvre carrelage', unit: 'h', price: 50, isLabor: true },
            { ref: 'MO-PARQ', name: 'Main d oeuvre parquet', unit: 'h', price: 48, isLabor: true },
            { ref: 'MO-ELEC', name: 'Main d oeuvre electricite', unit: 'h', price: 55, isLabor: true },
            { ref: 'MO-PLOMB', name: 'Main d oeuvre plomberie', unit: 'h', price: 58, isLabor: true },
            { ref: 'MO-MACON', name: 'Main d oeuvre maconnerie', unit: 'h', price: 52, isLabor: true },
            { ref: 'DEPL', name: 'Frais de deplacement', unit: 'forfait', price: 35, isLabor: false },
            { ref: 'EVAC', name: 'Evacuation gravats', unit: 'forfait', price: 120, isLabor: false }
        ];

        for (const s of servicesData) {
            await client.query(`
                INSERT INTO services (user_id, ref, name, unit, unit_price, is_labor)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [userId, s.ref, s.name, s.unit, s.price, s.isLabor]);
        }

        // 5. Fournisseurs
        const suppliersData = [
            { name: 'Brico Pro', email: 'commandes@bricopro.be', phone: '+32 2 111 22 33', category: 'Materiaux generaux' },
            { name: 'Peintures Deluxe', email: 'info@peintures-deluxe.be', phone: '+32 4 444 55 66', category: 'Peinture' },
            { name: 'Carrelages & Co', email: 'commandes@carrelages-co.be', phone: '+32 9 777 88 99', category: 'Carrelage' }
        ];

        for (const s of suppliersData) {
            await client.query(`
                INSERT INTO suppliers (user_id, name, email, phone, category, active)
                VALUES ($1, $2, $3, $4, $5, TRUE)
            `, [userId, s.name, s.email, s.phone, s.category]);
        }

        // 6. Devis d'exemple
        const now = new Date();
        const quotesData = [
            {
                number: 'DEVIS-DEMO-0001',
                issueDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                validDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                clientId: clientIds[0],
                clientName: 'Vincent Dubois',
                items: [
                    { ref: 'PEINT-001', name: '[Peinture] Peinture acrylique blanche mate 5L', qty: 3, unitPrice: 45, total: 135 },
                    { ref: 'MO-PEINT', name: '[Peinture] Main d oeuvre peinture (12h)', qty: 12, unitPrice: 45, total: 540 }
                ],
                subtotal: 675,
                vatAmount: 141.75,
                total: 816.75,
                status: 'accepted'
            },
            {
                number: 'DEVIS-DEMO-0002',
                issueDate: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                validDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                clientId: clientIds[1],
                clientName: 'Martin SA',
                items: [
                    { ref: 'PLACO-001', name: '[Placo] Plaque BA13 2.5x1.2m', qty: 14, unitPrice: 8.50, total: 119 },
                    { ref: 'PLACO-002', name: '[Placo] Montant metallique 48mm', qty: 10, unitPrice: 4.20, total: 42 },
                    { ref: 'MO-PLACO', name: '[Placo] Main d oeuvre placo (15h)', qty: 15, unitPrice: 48, total: 720 }
                ],
                subtotal: 881,
                vatAmount: 185.01,
                total: 1066.01,
                status: 'sent'
            },
            {
                number: 'DEVIS-DEMO-0003',
                issueDate: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                validDate: new Date(now.getTime() + 22 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                clientId: clientIds[2],
                clientName: 'Leroy Immobilier',
                items: [
                    { ref: 'CARR-001', name: '[Carrelage] Carrelage gres cerame 60x60', qty: 25, unitPrice: 25, total: 625 },
                    { ref: 'CARR-002', name: '[Carrelage] Colle carrelage 25kg', qty: 4, unitPrice: 14, total: 56 },
                    { ref: 'MO-CARR', name: '[Carrelage] Main d oeuvre carrelage (30h)', qty: 30, unitPrice: 50, total: 1500 }
                ],
                subtotal: 2181,
                vatAmount: 458.01,
                total: 2639.01,
                status: 'draft'
            },
            {
                number: 'DEVIS-DEMO-0004',
                issueDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                validDate: new Date(now.getTime() + 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                clientId: clientIds[3],
                clientName: 'Dupont & Fils',
                items: [
                    { ref: 'PLOMB-001', name: '[Plomberie] WC complet suspendu', qty: 2, unitPrice: 280, total: 560 },
                    { ref: 'PLOMB-002', name: '[Plomberie] Lavabo + robinetterie', qty: 1, unitPrice: 180, total: 180 },
                    { ref: 'MO-PLOMB', name: '[Plomberie] Main d oeuvre plomberie (8h)', qty: 8, unitPrice: 58, total: 464 }
                ],
                subtotal: 1204,
                vatAmount: 252.84,
                total: 1456.84,
                status: 'sent'
            }
        ];

        for (const q of quotesData) {
            await client.query(`
                INSERT INTO quotes (
                    user_id, quote_number, issue_date, valid_date,
                    subtotal, vat_amount, total, vat_regime, status, items,
                    client_id, client_name, currency, exchange_rate
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'assujetti', $8, $9, $10, $11, 'EUR', 1.0)
            `, [
                userId, q.number, q.issueDate, q.validDate,
                q.subtotal, q.vatAmount, q.total, q.status,
                JSON.stringify(q.items),
                q.clientId, q.clientName
            ]);
        }

        // 7. Chantier d'exemple
        const chantierResult = await client.query(`
            INSERT INTO chantiers (
                user_id, name, reference, description,
                client_id, client_name, client_address,
                status, budget_estimate, start_date, end_date, color
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        `, [
            userId,
            'Renovation appartement Vincent Dubois',
            'CH-DEMO-001',
            'Renovation complete : peinture, parquet, electricite',
            clientIds[0],
            'Vincent Dubois',
            '45 avenue Louise, 1050 Bruxelles',
            'in_progress',
            8500,
            new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            '#f97316'
        ]);

        // 8. Lier le premier devis au chantier
        await client.query(
            'UPDATE quotes SET chantier_id = $1 WHERE user_id = $2 AND quote_number = $3',
            [chantierResult.rows[0].id, userId, 'DEVIS-DEMO-0001']
        );

        // 9. Evenement chantier
        await client.query(`
            INSERT INTO chantier_events (user_id, chantier_id, event_type, event_data)
            VALUES ($1, $2, 'created', $3)
        `, [userId, chantierResult.rows[0].id, JSON.stringify({ name: 'Renovation appartement Vincent Dubois' })]);

        // 10. Sous-traitant demo
        const subResult = await client.query(`
            INSERT INTO subcontractors (
                user_id, name, company_name, contact_name, email, phone,
                specialty, hourly_rate, payment_terms, active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
            RETURNING id
        `, [
            userId,
            'Electricien Dupont',
            'Dupont Electricite SARL',
            'Vincent Dupont',
            'contact@dupont-elec.be',
            '+32 475 11 22 33',
            'Electricite',
            55,
            30
        ]);

        // 11. Mission sous-traitant
        await client.query(`
            INSERT INTO subcontractor_assignments (
                user_id, subcontractor_id, chantier_id,
                title, description, amount, hourly_rate,
                estimated_hours, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            userId,
            subResult.rows[0].id,
            chantierResult.rows[0].id,
            'Installation tableau electrique + prises',
            'Remplacement du tableau, 12 prises, 4 interrupteurs',
            1200,
            55,
            22,
            'in_progress'
        ]);

        await client.query('COMMIT');
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur seedDemoData:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { seedDemoData };