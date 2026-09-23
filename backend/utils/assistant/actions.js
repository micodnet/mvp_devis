// // backend/utils/assistant/actions.js
// // Actions d'écriture disponibles pour l'assistant.
// // Chaque action a 2 phases : prepare() (brouillon) et execute() (réelle insertion)

// const { pool } = require('../../db');

// // ============================================================
// // DÉFINITION DES ACTIONS
// // ============================================================
// // Chaque action a :
// // - type : identifiant unique
// // - label : texte lisible pour l'utilisateur
// // - prepare(args, userId) : vérifie les données et renvoie un brouillon
// // - execute(args, userId) : effectue réellement l'action

// const ACTIONS = {

//     // ----------------------------------------------------------
//     // CRÉER UN CLIENT
//     // ----------------------------------------------------------
//     create_client: {
//         label: 'Créer un nouveau client',
//         async prepare(args, userId) {
//             if (!args.name) throw new Error('Le nom du client est obligatoire.');
//             return {
//                 type: 'create_client',
//                 summary: `Créer le client "${args.name}"`,
//                 preview: {
//                     'Nom': args.name,
//                     'Personne de contact': args.contactName || '—',
//                     'Email': args.email || '—',
//                     'Téléphone': args.phone || '—',
//                     'Adresse': args.address || '—',
//                     'N° TVA': args.vatNumber || '—'
//                 },
//                 payload: args
//             };
//         },
//         async execute(args, userId) {
//             const result = await pool.query(`
//                 INSERT INTO clients (user_id, name, contact_name, email, phone, address, vat_number, notes)
//                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//                 RETURNING id, name
//             `, [
//                 userId, args.name.trim(), args.contactName || null, args.email || null,
//                 args.phone || null, args.address || null, args.vatNumber || null, args.notes || null
//             ]);
//             return { id: result.rows[0].id, name: result.rows[0].name };
//         }
//     },

//     // ----------------------------------------------------------
//     // CRÉER UN PRODUIT
//     // ----------------------------------------------------------
//     create_product: {
//         label: 'Créer un nouveau produit',
//         async prepare(args, userId) {
//             if (!args.name) throw new Error('Le nom du produit est obligatoire.');
//             const price = parseFloat(args.unitPrice);
//             if (isNaN(price) || price < 0) throw new Error('Prix invalide ou manquant.');
//             return {
//                 type: 'create_product',
//                 summary: `Créer le produit "${args.name}"`,
//                 preview: {
//                     'Nom': args.name,
//                     'Référence': args.ref || '—',
//                     'Prix HT': price.toFixed(2) + ' €',
//                     'Unité': args.unit || 'u',
//                     'Catégorie': args.category || '—'
//                 },
//                 payload: { ...args, unitPrice: price }
//             };
//         },
//         async execute(args, userId) {
//             const result = await pool.query(`
//                 INSERT INTO products (user_id, ref, name, description, unit, unit_price, category)
//                 VALUES ($1, $2, $3, $4, $5, $6, $7)
//                 RETURNING id, name
//             `, [
//                 userId, args.ref || null, args.name.trim(), args.description || null,
//                 args.unit || 'u', args.unitPrice, args.category || null
//             ]);
//             return { id: result.rows[0].id, name: result.rows[0].name };
//         }
//     },

//     // ----------------------------------------------------------
//     // CRÉER UN SERVICE
//     // ----------------------------------------------------------
//     create_service: {
//         label: 'Créer un nouveau service',
//         async prepare(args, userId) {
//             if (!args.name) throw new Error('Le nom du service est obligatoire.');
//             const price = parseFloat(args.unitPrice);
//             if (isNaN(price) || price < 0) throw new Error('Prix invalide ou manquant.');
//             return {
//                 type: 'create_service',
//                 summary: `Créer le service "${args.name}"`,
//                 preview: {
//                     'Nom': args.name,
//                     'Prix HT': price.toFixed(2) + ' €',
//                     'Unité': args.unit || 'forfait',
//                     'Catégorie': args.category || '—',
//                     'Type': args.isLabor ? 'Main d\'œuvre' : 'Prestation'
//                 },
//                 payload: { ...args, unitPrice: price }
//             };
//         },
//         async execute(args, userId) {
//             const result = await pool.query(`
//                 INSERT INTO services (user_id, ref, name, description, unit, unit_price, category, is_labor)
//                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//                 RETURNING id, name
//             `, [
//                 userId, args.ref || null, args.name.trim(), args.description || null,
//                 args.unit || 'forfait', args.unitPrice, args.category || null,
//                 args.isLabor === true
//             ]);
//             return { id: result.rows[0].id, name: result.rows[0].name };
//         }
//     },

//     // ----------------------------------------------------------
//     // CRÉER UN FOURNISSEUR
//     // ----------------------------------------------------------
//     create_supplier: {
//         label: 'Créer un nouveau fournisseur',
//         async prepare(args, userId) {
//             if (!args.name) throw new Error('Le nom du fournisseur est obligatoire.');
//             return {
//                 type: 'create_supplier',
//                 summary: `Créer le fournisseur "${args.name}"`,
//                 preview: {
//                     'Nom': args.name,
//                     'Contact': args.contactName || '—',
//                     'Email': args.email || '—',
//                     'Téléphone': args.phone || '—',
//                     'Catégorie': args.category || '—',
//                     'Délai livraison': (args.deliveryDays || 7) + ' jours'
//                 },
//                 payload: args
//             };
//         },
//         async execute(args, userId) {
//             const result = await pool.query(`
//                 INSERT INTO suppliers (user_id, name, contact_name, email, phone, address, vat_number, category, delivery_days, payment_terms, notes)
//                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
//                 RETURNING id, name
//             `, [
//                 userId, args.name.trim(), args.contactName || null, args.email || null,
//                 args.phone || null, args.address || null, args.vatNumber || null,
//                 args.category || null, parseInt(args.deliveryDays) || 7,
//                 parseInt(args.paymentTerms) || 30, args.notes || null
//             ]);
//             return { id: result.rows[0].id, name: result.rows[0].name };
//         }
//     },

//     // ----------------------------------------------------------
//     // AJUSTER LE STOCK
//     // ----------------------------------------------------------
//     adjust_stock: {
//         label: 'Ajuster le stock d\'un produit',
//         async prepare(args, userId) {
//             if (!args.productRef && !args.productName) throw new Error('Précisez le produit (réf ou nom).');
//             const qty = parseFloat(args.quantity);
//             if (isNaN(qty) || qty === 0) throw new Error('Quantité invalide.');

//             // Chercher le produit
//             const term = args.productRef || args.productName;
//             const prodResult = await pool.query(`
//                 SELECT id, ref, name, stock_quantity
//                 FROM products
//                 WHERE user_id = $1 AND (LOWER(ref) = LOWER($2) OR LOWER(name) LIKE LOWER($3))
//                 LIMIT 1
//             `, [userId, term, `%${term}%`]);
//             if (prodResult.rows.length === 0) throw new Error(`Produit "${term}" introuvable.`);
//             const product = prodResult.rows[0];

//             const currentStock = parseFloat(product.stock_quantity) || 0;
//             const movementType = args.movementType || (qty > 0 ? 'in' : 'out');
//             const absQty = Math.abs(qty);
//             let newStock;
//             if (movementType === 'in') newStock = currentStock + absQty;
//             else if (movementType === 'out') newStock = currentStock - absQty;
//             else newStock = absQty; // adjustment

//             return {
//                 type: 'adjust_stock',
//                 summary: `Ajuster le stock de "${product.name}"`,
//                 preview: {
//                     'Produit': product.name,
//                     'Référence': product.ref || '—',
//                     'Stock actuel': currentStock,
//                     'Mouvement': movementType === 'in' ? `+ ${absQty}` : movementType === 'out' ? `- ${absQty}` : `= ${absQty}`,
//                     'Nouveau stock': newStock,
//                     'Motif': args.reason || 'Ajustement manuel'
//                 },
//                 payload: {
//                     productId: product.id,
//                     movementType,
//                     quantity: absQty,
//                     reason: args.reason || 'Ajustement via assistant IA'
//                 }
//             };
//         },
//         async execute(args, userId) {
//             const client = await pool.connect();
//             try {
//                 await client.query('BEGIN');

//                 const prodResult = await client.query(
//                     'SELECT stock_quantity FROM products WHERE id = $1 AND user_id = $2',
//                     [args.productId, userId]
//                 );
//                 if (prodResult.rows.length === 0) throw new Error('Produit introuvable.');
//                 const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;

//                 let newStock = currentStock;
//                 if (args.movementType === 'in') newStock = currentStock + args.quantity;
//                 else if (args.movementType === 'out') newStock = currentStock - args.quantity;
//                 else newStock = args.quantity;

//                 await client.query(`
//                     INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason)
//                     VALUES ($1, $2, $3, $4, $5)
//                 `, [userId, args.productId, args.movementType, args.quantity, args.reason]);

//                 await client.query(
//                     'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
//                     [newStock, args.productId]
//                 );

//                 await client.query('COMMIT');
//                 return { productId: args.productId, newStock };
//             } catch (err) {
//                 await client.query('ROLLBACK');
//                 throw err;
//             } finally {
//                 client.release();
//             }
//         }
//     },

//     // ----------------------------------------------------------
//     // CRÉER UN DEVIS SIMPLE (sans IA d'extraction, juste à partir d'items dictés)
//     // ----------------------------------------------------------
//     create_quote_simple: {
//         label: 'Créer un devis',
//         async prepare(args, userId) {
//             if (!args.items || !Array.isArray(args.items) || args.items.length === 0) {
//                 throw new Error('Aucun article fourni pour le devis.');
//             }
//             const clientName = args.clientName || args.client || 'Client non précisé';

//             // Calculer totaux
//             let subtotal = 0;
//             const itemsFormatted = [];
//             for (const item of args.items) {
//                 const qty = parseFloat(item.qty) || 1;
//                 const unitPrice = parseFloat(item.unitPrice) || 0;
//                 const total = qty * unitPrice;
//                 subtotal += total;
//                 itemsFormatted.push({
//                     ref: item.ref || 'EXT-' + Math.random().toString(36).slice(2,6).toUpperCase(),
//                     name: item.name,
//                     qty,
//                     unitPrice,
//                     total
//                 });
//             }
//             const vatRate = parseFloat(args.vatRate) || 21;
//             const vatAmount = args.vatRegime === 'assujetti' ? subtotal * (vatRate/100) : 0;
//             const total = subtotal + vatAmount;

//             return {
//                 type: 'create_quote_simple',
//                 summary: `Créer un devis pour "${clientName}"`,
//                 preview: {
//                     'Client': clientName,
//                     'Articles': itemsFormatted.length + ' ligne(s)',
//                     'Sous-total HT': subtotal.toFixed(2) + ' €',
//                     'TVA': vatAmount.toFixed(2) + ' €',
//                     'Total TTC': total.toFixed(2) + ' €'
//                 },
//                 payload: {
//                     clientName,
//                     clientEmail: args.clientEmail || null,
//                     clientAddress: args.clientAddress || null,
//                     items: itemsFormatted,
//                     subtotal,
//                     vatAmount,
//                     total,
//                     vatRegime: args.vatRegime || 'franchise',
//                     vatRate
//                 }
//             };
//         },
//         async execute(args, userId) {
//             const client = await pool.connect();
//             try {
//                 await client.query('BEGIN');

//                 // 🔑 Recalculer les totaux à partir des items (au cas où ils ne seraient pas fournis)
//                 // Cela rend l'action robuste aux appels depuis le Module 4 (calculer_chantier)
//                 const items = Array.isArray(args.items) ? args.items : [];

//                 if (items.length === 0) {
//                     throw new Error('Aucun article fourni pour créer le devis.');
//                 }

//                 // Calcul du sous-total HT
//                 let subtotal = 0;
//                 for (const item of items) {
//                     const qty = parseFloat(item.qty) || 0;
//                     const unitPrice = parseFloat(item.unitPrice) || 0;
//                     const lineTotal = parseFloat(item.total) || (qty * unitPrice);
//                     subtotal += lineTotal;

//                     // Normaliser les items (garantir qty, unitPrice, total)
//                     item.qty = qty;
//                     item.unitPrice = unitPrice;
//                     item.total = lineTotal;
//                 }

//                 subtotal = Math.round(subtotal * 100) / 100;

//                 // Récupérer le régime TVA depuis les settings si non fourni
//                 let vatRegime = args.vatRegime;
//                 let vatRate = parseFloat(args.vatRate) || 21;

//                 if (!vatRegime) {
//                     const settingsRes = await client.query(
//                         'SELECT vat_regime, vat_rate FROM settings WHERE user_id = $1',
//                         [userId]
//                     );
//                     if (settingsRes.rows.length > 0) {
//                         vatRegime = settingsRes.rows[0].vat_regime || 'franchise';
//                         vatRate = parseFloat(settingsRes.rows[0].vat_rate) || 21;
//                     } else {
//                         vatRegime = 'franchise';
//                     }
//                 }

//                 // Calcul TVA
//                 const vatAmount = vatRegime === 'assujetti'
//                     ? Math.round(subtotal * (vatRate / 100) * 100) / 100
//                     : 0;

//                 const total = Math.round((subtotal + vatAmount) * 100) / 100;

//                 // Sécurité : jamais de null dans total
//                 if (!Number.isFinite(total)) {
//                     throw new Error('Impossible de calculer le total du devis.');
//                 }

//                 // Numéro de devis (compteur par utilisateur)
//                 const counterResult = await client.query(
//                     'SELECT last_number FROM counters WHERE user_id = $1',
//                     [userId]
//                 );
//                 let newNumber = 1;
//                 if (counterResult.rows.length > 0) {
//                     newNumber = counterResult.rows[0].last_number + 1;
//                     await client.query(
//                         'UPDATE counters SET last_number = $1 WHERE user_id = $2',
//                         [newNumber, userId]
//                     );
//                 } else {
//                     await client.query(
//                         'INSERT INTO counters (user_id, last_number) VALUES ($1, 1)',
//                         [userId]
//                     );
//                 }
//                 const quoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

//                 const issueDate = new Date().toISOString().slice(0, 10);
//                 const validUntil = new Date();
//                 validUntil.setDate(validUntil.getDate() + 30);
//                 const validDate = validUntil.toISOString().slice(0, 10);

//                 const result = await client.query(`
//                     INSERT INTO quotes (
//                         user_id, quote_number, issue_date, valid_date,
//                         subtotal, vat_amount, total, vat_regime, status, items,
//                         client_name, client_address, client_email
//                     )
//                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12)
//                     RETURNING id, quote_number
//                 `, [
//                     userId,
//                     quoteNumber,
//                     issueDate,
//                     validDate,
//                     subtotal,
//                     vatAmount,
//                     total,
//                     vatRegime,
//                     JSON.stringify(items),
//                     args.clientName || 'Client à préciser',
//                     args.clientAddress || null,
//                     args.clientEmail || null
//                 ]);

//                 await client.query('COMMIT');
//                 return {
//                     id: result.rows[0].id,
//                     quoteNumber: result.rows[0].quote_number,
//                     subtotal,
//                     vatAmount,
//                     total,
//                     itemsCount: items.length
//                 };
//             } catch (err) {
//                 await client.query('ROLLBACK');
//                 throw err;
//             } finally {
//                 client.release();
//             }
//         }
//     },  // 🔑 VIRGULE ICI (indispensable pour séparer de update_quote)

//     // ----------------------------------------------------------
//     // MODIFIER UN DEVIS EXISTANT
//     // ----------------------------------------------------------
//     update_quote: {
//         label: 'Modifier un devis existant',
//         // async prepare(args, userId) {
//         //     // Trouver le devis cible
//         //     let quote = null;

//         //     if (args.quoteId) {
//         //         const res = await pool.query(
//         //             'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
//         //             [parseInt(args.quoteId), userId]
//         //         );
//         //         if (res.rows.length > 0) quote = res.rows[0];
//         //     } else if (args.quoteNumber) {
//         //         const res = await pool.query(
//         //             'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
//         //             [args.quoteNumber, userId]
//         //         );
//         //         if (res.rows.length > 0) quote = res.rows[0];
//         //     } else {
//         //         // "le dernier devis" = le plus récent
//         //         const res = await pool.query(
//         //             'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
//         //             [userId]
//         //         );
//         //         if (res.rows.length > 0) quote = res.rows[0];
//         //     }

//         //     if (!quote) {
//         //         throw new Error('Aucun devis trouvé à modifier.');
//         //     }

//         //     // Construire le patch : seuls les champs fournis sont modifiés
//         //     const patch = {};

//         //     if (args.clientName !== undefined) patch.clientName = args.clientName;
//         //     if (args.clientAddress !== undefined) patch.clientAddress = args.clientAddress;
//         //     if (args.clientEmail !== undefined) patch.clientEmail = args.clientEmail;
//         //     if (args.clientVat !== undefined) patch.clientVat = args.clientVat;
//         //     if (args.status !== undefined) patch.status = args.status;
//         //     if (args.validDate !== undefined) patch.validDate = args.validDate;
//         //     if (args.vatRegime !== undefined) patch.vatRegime = args.vatRegime;

//         //     if (Object.keys(patch).length === 0) {
//         //         throw new Error('Aucun champ à modifier fourni. Précisez ce que vous voulez changer (client, statut, date de validité, etc.).');
//         //     }
//         async prepare(args, userId) {
//             // 🆕 ÉTAPE 0 : vérifier si args contient un patch "imbriqué" (bug fréquent)
//             // Groq peut retourner {"patch":{...}} ou {"clientName":"..."} directement
//             if (args && args.patch && typeof args.patch === 'object') {
//                 // Si patch est un objet vide {}, on considère qu'il n'y a rien
//                 if (Object.keys(args.patch).length > 0) {
//                     // Fusionner patch dans args pour unifier le traitement
//                     args = { ...args, ...args.patch };
//                 }
//             }

//             // 🆕 ÉTAPE 0.5 : si l'utilisateur a donné un nom dans args mais mal nommé,
//             // on essaie de le récupérer
//             if (!args.clientName) {
//                 // Chercher d'autres noms de champs possibles retournés par Groq
//                 const possibleNameFields = ['nom', 'name', 'nomClient', 'client', 'client_name', 'newClientName'];
//                 for (const field of possibleNameFields) {
//                     if (args[field] && typeof args[field] === 'string') {
//                         args.clientName = args[field];
//                         break;
//                     }
//                 }
//             }

//             // Trouver le devis cible
//             let quote = null;

//             if (args.quoteId) {
//                 const res = await pool.query(
//                     'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
//                     [parseInt(args.quoteId), userId]
//                 );
//                 if (res.rows.length > 0) quote = res.rows[0];
//             } else if (args.quoteNumber) {
//                 const res = await pool.query(
//                     'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
//                     [args.quoteNumber, userId]
//                 );
//                 if (res.rows.length > 0) quote = res.rows[0];
//             } else {
//                 // "le dernier devis" = le plus récent
//                 const res = await pool.query(
//                     'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
//                     [userId]
//                 );
//                 if (res.rows.length > 0) quote = res.rows[0];
//             }

//             if (!quote) {
//                 throw new Error('Aucun devis trouvé à modifier.');
//             }

//             // Construire le patch : seuls les champs fournis sont modifiés
//             const patch = {};

//             if (args.clientName !== undefined && args.clientName !== null && args.clientName !== '') patch.clientName = String(args.clientName).trim();
//             if (args.clientAddress !== undefined) patch.clientAddress = args.clientAddress;
//             if (args.clientEmail !== undefined) patch.clientEmail = args.clientEmail;
//             if (args.clientVat !== undefined) patch.clientVat = args.clientVat;
//             if (args.status !== undefined) patch.status = args.status;
//             if (args.validDate !== undefined) patch.validDate = args.validDate;
//             if (args.vatRegime !== undefined) patch.vatRegime = args.vatRegime;

//             if (Object.keys(patch).length === 0) {
//                 console.log('🔍 [update_quote] args reçus (patch vide) :', JSON.stringify(args));
//                 throw new Error('Aucun champ à modifier fourni. Précisez ce que vous voulez changer (client, statut, date de validité, etc.).');
//             }

//             // Construire le preview lisible
//             const preview = {
//                 'Devis': quote.quote_number,
//                 'Client actuel': quote.client_name || '—',
//                 'Total actuel': parseFloat(quote.total).toFixed(2) + ' €'
//             };
//             for (const [k, v] of Object.entries(patch)) {
//                 const labels = {
//                     clientName: 'Nouveau client',
//                     clientAddress: 'Nouvelle adresse',
//                     clientEmail: 'Nouvel email',
//                     clientVat: 'Nouveau n° TVA',
//                     status: 'Nouveau statut',
//                     validDate: 'Nouvelle date de validité',
//                     vatRegime: 'Nouveau régime TVA'
//                 };
//                 preview[labels[k] || k] = v || '—';
//             }

//             return {
//                 type: 'update_quote',
//                 summary: `Modifier le devis ${quote.quote_number}`,
//                 preview,
//                 payload: {
//                     quoteId: quote.id,
//                     quoteNumber: quote.quote_number,
//                     patch
//                 }
//             };
//         },
//         async execute(args, userId) {
//             const { quoteId, patch } = args;

//             if (!quoteId || !patch || Object.keys(patch).length === 0) {
//                 throw new Error('Paramètres invalides pour update_quote.');
//             }

//             // Construire dynamiquement la requête UPDATE
//             const fields = [];
//             const values = [];
//             let idx = 1;

//             const fieldMap = {
//                 clientName: 'client_name',
//                 clientAddress: 'client_address',
//                 clientEmail: 'client_email',
//                 clientVat: 'client_vat',
//                 status: 'status',
//                 validDate: 'valid_date',
//                 vatRegime: 'vat_regime'
//             };

//             for (const [key, val] of Object.entries(patch)) {
//                 const col = fieldMap[key];
//                 if (!col) continue;
//                 fields.push(`${col} = $${idx}`);
//                 values.push(val);
//                 idx++;
//             }

//             if (fields.length === 0) {
//                 throw new Error('Aucun champ valide à modifier.');
//             }

//             values.push(quoteId, userId);

//             const result = await pool.query(`
//                 UPDATE quotes
//                 SET ${fields.join(', ')}, updated_at = NOW()
//                 WHERE id = $${idx} AND user_id = $${idx + 1}
//                 RETURNING id, quote_number, client_name, status, total
//             `, values);

//             if (result.rows.length === 0) {
//                 throw new Error('Devis introuvable ou non autorisé.');
//             }

//             return {
//                 id: result.rows[0].id,
//                 quoteNumber: result.rows[0].quote_number,
//                 clientName: result.rows[0].client_name,
//                 status: result.rows[0].status,
//                 total: parseFloat(result.rows[0].total)
//             };
//         }
//     },

//     // ----------------------------------------------------------
//     // SAUVEGARDER UNE PRÉFÉRENCE UTILISATEUR
//     // ----------------------------------------------------------
//     save_preference: {
//         label: 'Sauvegarder une préférence',
//         async prepare(args, userId) {
//             if (!args.preference || !args.value) {
//                 throw new Error('Précisez la préférence et sa valeur (ex: "taux horaire par défaut 50€").');
//             }

//             const prefKey = String(args.preference).toLowerCase().trim();
//             const validPrefs = {
//                 'taux horaire': 'defaultHourlyRate',
//                 'taux horaire par défaut': 'defaultHourlyRate',
//                 'hourly rate': 'defaultHourlyRate',
//                 'marge': 'defaultMarginPercent',
//                 'marge par défaut': 'defaultMarginPercent',
//                 'tva': 'defaultVatRate',
//                 'taux tva': 'defaultVatRate',
//                 'régime tva': 'defaultVatRegime',
//                 'regime tva': 'defaultVatRegime',
//                 'conditions de paiement': 'defaultPaymentTerms',
//                 'délai de paiement': 'defaultPaymentTerms',
//                 'delai de paiement': 'defaultPaymentTerms'
//             };

//             const mappedKey = validPrefs[prefKey];
//             if (!mappedKey) {
//                 throw new Error(`Préférence non reconnue : "${args.preference}". Valeurs possibles : taux horaire, marge, TVA, régime TVA, conditions de paiement.`);
//             }

//             let parsedValue = args.value;

//             if (mappedKey === 'defaultHourlyRate' || mappedKey === 'defaultMarginPercent' || mappedKey === 'defaultVatRate') {
//                 parsedValue = parseFloat(String(args.value).replace(',', '.'));
//                 if (isNaN(parsedValue) || parsedValue < 0) {
//                     throw new Error(`Valeur numérique invalide : "${args.value}"`);
//                 }
//             } else if (mappedKey === 'defaultPaymentTerms') {
//                 parsedValue = parseInt(String(args.value).replace(/\D/g, ''));
//                 if (isNaN(parsedValue) || parsedValue < 0) {
//                     throw new Error(`Délai invalide : "${args.value}"`);
//                 }
//             } else if (mappedKey === 'defaultVatRegime') {
//                 const v = String(args.value).toLowerCase();
//                 if (v.includes('franchise')) parsedValue = 'franchise';
//                 else if (v.includes('assujetti')) parsedValue = 'assujetti';
//                 else throw new Error('Régime TVA invalide. Utilisez "franchise" ou "assujetti".');
//             }

//             const labels = {
//                 defaultHourlyRate: 'Taux horaire par défaut',
//                 defaultMarginPercent: 'Marge par défaut',
//                 defaultVatRate: 'Taux de TVA par défaut',
//                 defaultVatRegime: 'Régime TVA par défaut',
//                 defaultPaymentTerms: 'Conditions de paiement'
//             };

//             const unit = {
//                 defaultHourlyRate: ' €/h',
//                 defaultMarginPercent: ' %',
//                 defaultVatRate: ' %',
//                 defaultVatRegime: '',
//                 defaultPaymentTerms: ' jours'
//             };

//             return {
//                 type: 'save_preference',
//                 summary: `Sauvegarder la préférence "${labels[mappedKey]}"`,
//                 preview: {
//                     'Préférence': labels[mappedKey],
//                     'Nouvelle valeur': `${parsedValue}${unit[mappedKey]}`
//                 },
//                 payload: {
//                     preferenceKey: mappedKey,
//                     value: parsedValue
//                 }
//             };
//         },
//         async execute(args, userId) {
//             const { updateUserPreferences } = require('./preferences');
//             const updates = {};
//             updates[args.preferenceKey] = args.value;
//             const success = await updateUserPreferences(userId, updates);
//             if (!success) {
//                 throw new Error('Impossible de sauvegarder la préférence.');
//             }
//             return {
//                 preferenceKey: args.preferenceKey,
//                 value: args.value
//             };
//         }
//     }
// };

// module.exports = { ACTIONS };

// backend/utils/assistant/actions.js
// Actions d'écriture disponibles pour l'assistant.
// Chaque action a 2 phases : prepare() (brouillon) et execute() (réelle insertion)

const { pool } = require('../../db');

// ------------------------------------------------------------
// Helper : parse une date au format naturel → YYYY-MM-DD
// ------------------------------------------------------------
// function parseDateNatural(input) {
//     if (!input) return null;
//     const str = String(input).trim();

//     // Format ISO direct
//     if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

//     // Format FR : 31/12/2026 ou 31-12-2026
//     const frMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
//     if (frMatch) {
//         const d = parseInt(frMatch[1]);
//         const m = parseInt(frMatch[2]);
//         const y = parseInt(frMatch[3]);
//         return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
//     }

//     // "dans X jours"
//     const inDaysMatch = str.match(/dans\s+(\d+)\s+jours?/i);
//     if (inDaysMatch) {
//         const d = new Date();
//         d.setDate(d.getDate() + parseInt(inDaysMatch[1]));
//         return d.toISOString().slice(0, 10);
//     }

//     // "dans X semaines"
//     const inWeeksMatch = str.match(/dans\s+(\d+)\s+semaines?/i);
//     if (inWeeksMatch) {
//         const d = new Date();
//         d.setDate(d.getDate() + parseInt(inWeeksMatch[1]) * 7);
//         return d.toISOString().slice(0, 10);
//     }

//     // "dans X mois"
//     const inMonthsMatch = str.match(/dans\s+(\d+)\s+mois/i);
//     if (inMonthsMatch) {
//         const d = new Date();
//         d.setMonth(d.getMonth() + parseInt(inMonthsMatch[1]));
//         return d.toISOString().slice(0, 10);
//     }

//     // Essayer Date.parse
//     const parsed = new Date(str);
//     if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

//     return null;
// }
// ------------------------------------------------------------
// Parse une date au format naturel → YYYY-MM-DD
// ------------------------------------------------------------
function parseDateNatural(input) {
    if (!input) return null;
    const str = String(input).trim().toLowerCase();
    const now = new Date();

    // Format ISO direct
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // Format FR : 31/12/2026 ou 31-12-2026
    const frMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (frMatch) {
        const d = parseInt(frMatch[1]);
        const m = parseInt(frMatch[2]);
        const y = parseInt(frMatch[3]);
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // "dans X jours"
    const inDaysMatch = str.match(/dans\s+(\d+)\s+jours?/i);
    if (inDaysMatch) {
        const d = new Date(now);
        d.setDate(d.getDate() + parseInt(inDaysMatch[1]));
        return d.toISOString().slice(0, 10);
    }

    // "dans X semaines" / "dans une semaine"
    const inWeeksMatch = str.match(/dans\s+(\d+|une?)\s+semaines?/i);
    if (inWeeksMatch) {
        const n = inWeeksMatch[1] === 'une' || inWeeksMatch[1] === 'un' ? 1 : parseInt(inWeeksMatch[1]);
        const d = new Date(now);
        d.setDate(d.getDate() + n * 7);
        return d.toISOString().slice(0, 10);
    }

    // "dans X mois"
    const inMonthsMatch = str.match(/dans\s+(\d+|un|une?)\s+mois/i);
    if (inMonthsMatch) {
        const n = isNaN(parseInt(inMonthsMatch[1])) ? 1 : parseInt(inMonthsMatch[1]);
        const d = new Date(now);
        d.setMonth(d.getMonth() + n);
        return d.toISOString().slice(0, 10);
    }

    // "fin du mois"
    if (/fin\s+du\s+mois/i.test(str)) {
        const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return d.toISOString().slice(0, 10);
    }

    // "début du mois prochain"
    if (/d[ée]but\s+du\s+mois\s+prochain/i.test(str)) {
        const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return d.toISOString().slice(0, 10);
    }

    // "fin du mois prochain"
    if (/fin\s+du\s+mois\s+prochain/i.test(str)) {
        const d = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        return d.toISOString().slice(0, 10);
    }

    // "avant le 15 mars" ou "le 15 mars"
    const months = {
        'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3, 'avril': 4,
        'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8, 'aout': 8,
        'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12, 'decembre': 12
    };
    const frDateMatch = str.match(/(?:le\s+|avant\s+le\s+)?(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/i);
    if (frDateMatch) {
        const day = parseInt(frDateMatch[1]);
        const month = months[frDateMatch[2].toLowerCase()];
        let year = frDateMatch[3] ? parseInt(frDateMatch[3]) : now.getFullYear();
        // Si la date est déjà passée cette année, prendre l'année suivante
        if (!frDateMatch[3]) {
            const candidate = new Date(year, month - 1, day);
            if (candidate < now) year += 1;
        }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // "vendredi prochain", "lundi prochain"
    const daysMap = {
        'dimanche': 0, 'lundi': 1, 'mardi': 2, 'mercredi': 3,
        'jeudi': 4, 'vendredi': 5, 'samedi': 6
    };
    const nextDayMatch = str.match(/(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\s+prochain/i);
    if (nextDayMatch) {
        const targetDay = daysMap[nextDayMatch[1].toLowerCase()];
        const d = new Date(now);
        const diff = (targetDay - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return d.toISOString().slice(0, 10);
    }

    // Essayer Date.parse
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    return null;
}

// ------------------------------------------------------------
// Helper : récupère le taux de TVA de l'utilisateur
// ------------------------------------------------------------
async function getVatRate(client, userId) {
    const res = await client.query('SELECT vat_rate FROM settings WHERE user_id = $1', [userId]);
    return res.rows[0]?.vat_rate || 21;
}

// ------------------------------------------------------------
// Résout une référence relative à un devis
// "le dernier", "le premier", "l'avant-dernier", "le 3e", "n°5"
// ------------------------------------------------------------
async function resolveQuoteReference(userId, ref) {
    if (!ref) return null;
    const str = String(ref).toLowerCase().trim();

    // Nombre ordinal : "le 3e", "n°5", "le devis 5"
    const numMatch = str.match(/(?:n[°o]?\s*|devis\s+|le\s+|la\s+)?(\d+)(?:e|ème|er)?/);
    if (numMatch) {
        const n = parseInt(numMatch[1]);
        if (n > 0) {
            const res = await pool.query(
                'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT 1',
                [userId, n - 1]
            );
            if (res.rows.length > 0) return res.rows[0];
        }
    }

    // "avant-dernier"
    if (/avant[\s-]?dernier/i.test(str)) {
        const res = await pool.query(
            'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC OFFSET 1 LIMIT 1',
            [userId]
        );
        if (res.rows.length > 0) return res.rows[0];
    }

    // "premier" / "plus ancien"
    if (/premier|plus\s+ancien/i.test(str)) {
        const res = await pool.query(
            'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
            [userId]
        );
        if (res.rows.length > 0) return res.rows[0];
    }

    // Défaut : dernier
    const res = await pool.query(
        'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
}

// ------------------------------------------------------------
// Idem pour les factures
// ------------------------------------------------------------
async function resolveInvoiceReference(userId, ref) {
    if (!ref) return null;
    const str = String(ref).toLowerCase().trim();

    const numMatch = str.match(/(?:n[°o]?\s*|facture\s+|le\s+|la\s+)?(\d+)(?:e|ème|er)?/);
    if (numMatch) {
        const n = parseInt(numMatch[1]);
        if (n > 0) {
            const res = await pool.query(
                'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT 1',
                [userId, n - 1]
            );
            if (res.rows.length > 0) return res.rows[0];
        }
    }

    if (/avant[\s-]?dernier/i.test(str)) {
        const res = await pool.query(
            'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC OFFSET 1 LIMIT 1',
            [userId]
        );
        if (res.rows.length > 0) return res.rows[0];
    }

    if (/premier|plus\s+ancien/i.test(str)) {
        const res = await pool.query(
            'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
            [userId]
        );
        if (res.rows.length > 0) return res.rows[0];
    }

    const res = await pool.query(
        'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
}

async function getVatRate(client, userId) {
    const res = await client.query('SELECT vat_rate FROM settings WHERE user_id = $1', [userId]);
    return res.rows[0]?.vat_rate || 21;
}

const ACTIONS = {

    // ----------------------------------------------------------
    // CRÉER UN CLIENT
    // ----------------------------------------------------------
    create_client: {
        label: 'Créer un nouveau client',
        async prepare(args, userId) {
            if (!args.name) throw new Error('Le nom du client est obligatoire.');
            return {
                type: 'create_client',
                summary: `Créer le client "${args.name}"`,
                preview: {
                    'Nom': args.name,
                    'Personne de contact': args.contactName || '—',
                    'Email': args.email || '—',
                    'Téléphone': args.phone || '—',
                    'Adresse': args.address || '—',
                    'N° TVA': args.vatNumber || '—'
                },
                payload: args
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                INSERT INTO clients (user_id, name, contact_name, email, phone, address, vat_number, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, name
            `, [
                userId, args.name.trim(), args.contactName || null, args.email || null,
                args.phone || null, args.address || null, args.vatNumber || null, args.notes || null
            ]);
            return { id: result.rows[0].id, name: result.rows[0].name };
        }
    },

    // ----------------------------------------------------------
    // CRÉER UN PRODUIT
    // ----------------------------------------------------------
    create_product: {
        label: 'Créer un nouveau produit',
        async prepare(args, userId) {
            if (!args.name) throw new Error('Le nom du produit est obligatoire.');
            const price = parseFloat(args.unitPrice);
            if (isNaN(price) || price < 0) throw new Error('Prix invalide ou manquant.');
            return {
                type: 'create_product',
                summary: `Créer le produit "${args.name}"`,
                preview: {
                    'Nom': args.name,
                    'Référence': args.ref || '—',
                    'Prix HT': price.toFixed(2) + ' €',
                    'Unité': args.unit || 'u',
                    'Catégorie': args.category || '—'
                },
                payload: { ...args, unitPrice: price }
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                INSERT INTO products (user_id, ref, name, description, unit, unit_price, category)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, name
            `, [
                userId, args.ref || null, args.name.trim(), args.description || null,
                args.unit || 'u', args.unitPrice, args.category || null
            ]);
            return { id: result.rows[0].id, name: result.rows[0].name };
        }
    },

    // ----------------------------------------------------------
    // CRÉER UN SERVICE
    // ----------------------------------------------------------
    create_service: {
        label: 'Créer un nouveau service',
        async prepare(args, userId) {
            if (!args.name) throw new Error('Le nom du service est obligatoire.');
            const price = parseFloat(args.unitPrice);
            if (isNaN(price) || price < 0) throw new Error('Prix invalide ou manquant.');
            return {
                type: 'create_service',
                summary: `Créer le service "${args.name}"`,
                preview: {
                    'Nom': args.name,
                    'Prix HT': price.toFixed(2) + ' €',
                    'Unité': args.unit || 'forfait',
                    'Catégorie': args.category || '—',
                    'Type': args.isLabor ? 'Main d\'œuvre' : 'Prestation'
                },
                payload: { ...args, unitPrice: price }
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                INSERT INTO services (user_id, ref, name, description, unit, unit_price, category, is_labor)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, name
            `, [
                userId, args.ref || null, args.name.trim(), args.description || null,
                args.unit || 'forfait', args.unitPrice, args.category || null,
                args.isLabor === true
            ]);
            return { id: result.rows[0].id, name: result.rows[0].name };
        }
    },

    // ----------------------------------------------------------
    // CRÉER UN FOURNISSEUR
    // ----------------------------------------------------------
    create_supplier: {
        label: 'Créer un nouveau fournisseur',
        async prepare(args, userId) {
            if (!args.name) throw new Error('Le nom du fournisseur est obligatoire.');
            return {
                type: 'create_supplier',
                summary: `Créer le fournisseur "${args.name}"`,
                preview: {
                    'Nom': args.name,
                    'Contact': args.contactName || '—',
                    'Email': args.email || '—',
                    'Téléphone': args.phone || '—',
                    'Catégorie': args.category || '—',
                    'Délai livraison': (args.deliveryDays || 7) + ' jours'
                },
                payload: args
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                INSERT INTO suppliers (user_id, name, contact_name, email, phone, address, vat_number, category, delivery_days, payment_terms, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id, name
            `, [
                userId, args.name.trim(), args.contactName || null, args.email || null,
                args.phone || null, args.address || null, args.vatNumber || null,
                args.category || null, parseInt(args.deliveryDays) || 7,
                parseInt(args.paymentTerms) || 30, args.notes || null
            ]);
            return { id: result.rows[0].id, name: result.rows[0].name };
        }
    },

    // ----------------------------------------------------------
    // AJUSTER LE STOCK
    // ----------------------------------------------------------
    adjust_stock: {
        label: 'Ajuster le stock d\'un produit',
        async prepare(args, userId) {
            if (!args.productRef && !args.productName) throw new Error('Précisez le produit (réf ou nom).');
            const qty = parseFloat(args.quantity);
            if (isNaN(qty) || qty === 0) throw new Error('Quantité invalide.');

            const term = args.productRef || args.productName;
            const prodResult = await pool.query(`
                SELECT id, ref, name, stock_quantity
                FROM products
                WHERE user_id = $1 AND (LOWER(ref) = LOWER($2) OR LOWER(name) LIKE LOWER($3))
                LIMIT 1
            `, [userId, term, `%${term}%`]);
            if (prodResult.rows.length === 0) throw new Error(`Produit "${term}" introuvable.`);
            const product = prodResult.rows[0];

            const currentStock = parseFloat(product.stock_quantity) || 0;
            const movementType = args.movementType || (qty > 0 ? 'in' : 'out');
            const absQty = Math.abs(qty);
            let newStock;
            if (movementType === 'in') newStock = currentStock + absQty;
            else if (movementType === 'out') newStock = currentStock - absQty;
            else newStock = absQty;

            return {
                type: 'adjust_stock',
                summary: `Ajuster le stock de "${product.name}"`,
                preview: {
                    'Produit': product.name,
                    'Référence': product.ref || '—',
                    'Stock actuel': currentStock,
                    'Mouvement': movementType === 'in' ? `+ ${absQty}` : movementType === 'out' ? `- ${absQty}` : `= ${absQty}`,
                    'Nouveau stock': newStock,
                    'Motif': args.reason || 'Ajustement manuel'
                },
                payload: {
                    productId: product.id,
                    movementType,
                    quantity: absQty,
                    reason: args.reason || 'Ajustement via assistant IA'
                }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const prodResult = await client.query(
                    'SELECT stock_quantity FROM products WHERE id = $1 AND user_id = $2',
                    [args.productId, userId]
                );
                if (prodResult.rows.length === 0) throw new Error('Produit introuvable.');
                const currentStock = parseFloat(prodResult.rows[0].stock_quantity) || 0;

                let newStock = currentStock;
                if (args.movementType === 'in') newStock = currentStock + args.quantity;
                else if (args.movementType === 'out') newStock = currentStock - args.quantity;
                else newStock = args.quantity;

                await client.query(`
                    INSERT INTO stock_movements (user_id, product_id, movement_type, quantity, reason)
                    VALUES ($1, $2, $3, $4, $5)
                `, [userId, args.productId, args.movementType, args.quantity, args.reason]);

                await client.query(
                    'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                    [newStock, args.productId]
                );

                await client.query('COMMIT');
                return { productId: args.productId, newStock };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },

    // ----------------------------------------------------------
    // CRÉER UN DEVIS SIMPLE
    // ----------------------------------------------------------
    create_quote_simple: {
        label: 'Créer un devis',
        async prepare(args, userId) {
            if (!args.items || !Array.isArray(args.items) || args.items.length === 0) {
                throw new Error('Aucun article fourni pour le devis.');
            }
            const clientName = args.clientName || args.client || 'Client non précisé';

            let subtotal = 0;
            const itemsFormatted = [];
            for (const item of args.items) {
                const qty = parseFloat(item.qty) || 1;
                const unitPrice = parseFloat(item.unitPrice) || 0;
                const total = parseFloat(item.total) || (qty * unitPrice);
                subtotal += total;
                itemsFormatted.push({
                    ref: item.ref || 'EXT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
                    name: item.name,
                    qty,
                    unitPrice,
                    total
                });
            }
            const vatRate = parseFloat(args.vatRate) || 21;
            const vatAmount = args.vatRegime === 'assujetti' ? subtotal * (vatRate / 100) : 0;
            const total = subtotal + vatAmount;

            return {
                type: 'create_quote_simple',
                summary: `Créer un devis pour "${clientName}"`,
                preview: {
                    'Client': clientName,
                    'Articles': itemsFormatted.length + ' ligne(s)',
                    'Sous-total HT': subtotal.toFixed(2) + ' €',
                    'TVA': vatAmount.toFixed(2) + ' €',
                    'Total TTC': total.toFixed(2) + ' €'
                },
                payload: {
                    clientName,
                    clientEmail: args.clientEmail || null,
                    clientAddress: args.clientAddress || null,
                    clientVat: args.clientVat || null,
                    items: itemsFormatted,
                    subtotal,
                    vatAmount,
                    total,
                    vatRegime: args.vatRegime || 'franchise',
                    vatRate
                }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const items = Array.isArray(args.items) ? args.items : [];
                if (items.length === 0) {
                    throw new Error('Aucun article fourni pour créer le devis.');
                }

                let subtotal = 0;
                for (const item of items) {
                    const qty = parseFloat(item.qty) || 0;
                    const unitPrice = parseFloat(item.unitPrice) || 0;
                    const lineTotal = parseFloat(item.total) || (qty * unitPrice);
                    subtotal += lineTotal;
                    item.qty = qty;
                    item.unitPrice = unitPrice;
                    item.total = lineTotal;
                }

                subtotal = Math.round(subtotal * 100) / 100;

                let vatRegime = args.vatRegime;
                let vatRate = parseFloat(args.vatRate) || 21;

                if (!vatRegime) {
                    const settingsRes = await client.query(
                        'SELECT vat_regime, vat_rate FROM settings WHERE user_id = $1',
                        [userId]
                    );
                    if (settingsRes.rows.length > 0) {
                        vatRegime = settingsRes.rows[0].vat_regime || 'franchise';
                        vatRate = parseFloat(settingsRes.rows[0].vat_rate) || 21;
                    } else {
                        vatRegime = 'franchise';
                    }
                }

                const vatAmount = vatRegime === 'assujetti'
                    ? Math.round(subtotal * (vatRate / 100) * 100) / 100
                    : 0;

                const total = Math.round((subtotal + vatAmount) * 100) / 100;

                if (!Number.isFinite(total)) {
                    throw new Error('Impossible de calculer le total du devis.');
                }

                // Compteur
                const counterResult = await client.query(
                    'SELECT last_number FROM counters WHERE user_id = $1',
                    [userId]
                );
                let newNumber = 1;
                if (counterResult.rows.length > 0) {
                    newNumber = counterResult.rows[0].last_number + 1;
                    await client.query(
                        'UPDATE counters SET last_number = $1 WHERE user_id = $2',
                        [newNumber, userId]
                    );
                } else {
                    await client.query(
                        'INSERT INTO counters (user_id, last_number) VALUES ($1, 1)',
                        [userId]
                    );
                }
                const quoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

                const issueDate = new Date().toISOString().slice(0, 10);
                const validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + 30);
                const validDate = validUntil.toISOString().slice(0, 10);

                const result = await client.query(`
                    INSERT INTO quotes (
                        user_id, quote_number, issue_date, valid_date,
                        subtotal, vat_amount, total, vat_regime, status, items,
                        client_name, client_address, client_vat, client_email
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13)
                    RETURNING id, quote_number
                `, [
                    userId,
                    quoteNumber,
                    issueDate,
                    validDate,
                    subtotal,
                    vatAmount,
                    total,
                    vatRegime,
                    JSON.stringify(items),
                    args.clientName || 'Client à préciser',
                    args.clientAddress || null,
                    args.clientVat || null,
                    args.clientEmail || null
                ]);

                await client.query('COMMIT');
                return {
                    id: result.rows[0].id,
                    quoteNumber: result.rows[0].quote_number,
                    subtotal,
                    vatAmount,
                    total,
                    itemsCount: items.length
                };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },

    // ----------------------------------------------------------
    // MODIFIER UN DEVIS EXISTANT
    // ----------------------------------------------------------
    update_quote: {
        label: 'Modifier un devis existant',
        async prepare(args, userId) {
            // Si args contient un patch "imbriqué", on le fusionne
            if (args && args.patch && typeof args.patch === 'object') {
                if (Object.keys(args.patch).length > 0) {
                    args = { ...args, ...args.patch };
                }
            }

            // Récupérer le nom depuis d'autres champs potentiels
            if (!args.clientName) {
                const possibleNameFields = ['nom', 'name', 'nomClient', 'client', 'client_name', 'newClientName'];
                for (const field of possibleNameFields) {
                    if (args[field] && typeof args[field] === 'string') {
                        args.clientName = args[field];
                        break;
                    }
                }
            }

            // Trouver le devis cible
            let quote = null;

            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                // 🆕 Utilise la résolution relative
                quote = await resolveQuoteReference(userId, args.quoteRef || 'dernier');
                // const res = await pool.query(
                //     'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                //     [userId]
                // );
                // if (res.rows.length > 0) quote = res.rows[0];
            }

            if (!quote) {
                throw new Error('Aucun devis trouvé à modifier.');
            }

            // Construire le patch
            const patch = {};

            if (args.clientName !== undefined && args.clientName !== null && args.clientName !== '') {
                patch.clientName = String(args.clientName).trim();
            }
            if (args.clientAddress !== undefined) patch.clientAddress = args.clientAddress;
            if (args.clientEmail !== undefined) patch.clientEmail = args.clientEmail;
            if (args.clientVat !== undefined) patch.clientVat = args.clientVat;
            if (args.status !== undefined) patch.status = args.status;
            if (args.validDate !== undefined) {
                const parsed = parseDateNatural(args.validDate);
                if (parsed) patch.validDate = parsed;
            }
            if (args.vatRegime !== undefined) patch.vatRegime = args.vatRegime;

            if (Object.keys(patch).length === 0) {
                console.log('🔍 [update_quote] args reçus (patch vide) :', JSON.stringify(args));
                throw new Error('Aucun champ à modifier fourni. Précisez ce que vous voulez changer (client, statut, date de validité, etc.).');
            }

            // Preview lisible
            const preview = {
                'Devis': quote.quote_number,
                'Client actuel': quote.client_name || '—',
                'Total actuel': parseFloat(quote.total).toFixed(2) + ' €'
            };
            const labels = {
                clientName: 'Nouveau client',
                clientAddress: 'Nouvelle adresse',
                clientEmail: 'Nouvel email',
                clientVat: 'Nouveau n° TVA',
                status: 'Nouveau statut',
                validDate: 'Nouvelle date de validité',
                vatRegime: 'Nouveau régime TVA'
            };
            for (const [k, v] of Object.entries(patch)) {
                preview[labels[k] || k] = v || '—';
            }

            return {
                type: 'update_quote',
                summary: `Modifier le devis ${quote.quote_number}`,
                preview,
                payload: {
                    quoteId: quote.id,
                    quoteNumber: quote.quote_number,
                    patch
                }
            };
        },
        async execute(args, userId) {
            const { quoteId, patch } = args;

            if (!quoteId || !patch || Object.keys(patch).length === 0) {
                throw new Error('Paramètres invalides pour update_quote.');
            }

            const fields = [];
            const values = [];
            let idx = 1;

            // 🔑 clientVat inclus
            const fieldMap = {
                clientName: 'client_name',
                clientAddress: 'client_address',
                clientEmail: 'client_email',
                clientVat: 'client_vat',
                status: 'status',
                validDate: 'valid_date',
                vatRegime: 'vat_regime'
            };

            for (const [key, val] of Object.entries(patch)) {
                const col = fieldMap[key];
                if (!col) continue;
                fields.push(`${col} = $${idx}`);
                values.push(val);
                idx++;
            }

            if (fields.length === 0) {
                throw new Error('Aucun champ valide à modifier.');
            }

            values.push(quoteId, userId);

            const result = await pool.query(`
                UPDATE quotes
                SET ${fields.join(', ')}, updated_at = NOW()
                WHERE id = $${idx} AND user_id = $${idx + 1}
                RETURNING id, quote_number, client_name, client_email, status, total
            `, values);

            if (result.rows.length === 0) {
                throw new Error('Devis introuvable ou non autorisé.');
            }

            return {
                id: result.rows[0].id,
                quoteNumber: result.rows[0].quote_number,
                clientName: result.rows[0].client_name,
                clientEmail: result.rows[0].client_email,
                status: result.rows[0].status,
                total: parseFloat(result.rows[0].total)
            };
        }
    },

    // ----------------------------------------------------------
    // ENVOYER UN DEVIS PAR EMAIL
    // ----------------------------------------------------------
    send_quote_email: {
        label: 'Envoyer un devis par email',
        async prepare(args, userId) {
            // Trouver le devis cible
            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }

            if (!quote) throw new Error('Aucun devis trouvé à envoyer.');

            const email = args.email || quote.client_email;
            if (!email) {
                throw new Error(`Aucun email renseigné pour ce devis (${quote.quote_number}). Précisez un email : "envoie le devis à client@test.com".`);
            }

            return {
                type: 'send_quote_email',
                summary: `Envoyer le devis ${quote.quote_number} à ${email}`,
                preview: {
                    'Devis': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Destinataire': email,
                    'Total': parseFloat(quote.total).toFixed(2) + ' €'
                },
                payload: {
                    quoteId: quote.id,
                    email,
                    // On garde le quote complet pour générer le PDF
                    quote: {
                        items: quote.items,
                        subtotal: parseFloat(quote.subtotal) || 0,
                        vatAmount: parseFloat(quote.vat_amount) || 0,
                        total: parseFloat(quote.total),
                        vatRegime: quote.vat_regime,
                        quoteNumber: quote.quote_number,
                        issueDate: quote.issue_date,
                        validDate: quote.valid_date,
                        client: {
                            name: quote.client_name,
                            address: quote.client_address,
                            vat: quote.client_vat,
                            email: quote.client_email
                        }
                    }
                }
            };
        },
        async execute(args, userId) {
            const { Resend } = require('resend');
            const { generateQuotePDF } = require('../pdf-generator');

            const { quoteId, email, quote } = args;

            // Charger les settings entreprise
            const settingsResult = await pool.query(
                'SELECT * FROM settings WHERE user_id = $1',
                [userId]
            );
            const s = settingsResult.rows[0] || {};

            const company = {
                companyName: s.company_name,
                address: s.address,
                siret: s.siret,
                tva: s.tva,
                phone: s.phone,
                email: s.email,
                website: s.website,
                logo: s.logo,
                vatRegime: s.vat_regime,
                vatRate: parseFloat(s.vat_rate) || 21
            };

            const pdfBytes = await generateQuotePDF(
                quote.items,
                quote.subtotal,
                quote.vatAmount,
                quote.total,
                quote.vatRegime,
                company.vatRate,
                quote.quoteNumber,
                quote.issueDate,
                quote.validDate,
                company,
                quote.client,
                null, // pas de signature
                s.language || 'fr',
                s.pdf_template || 'classic'
            );

            const resend = new Resend(process.env.RESEND_API_KEY);

            const { error } = await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
                to: [email],
                subject: `Votre devis ${quote.quoteNumber}`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h1 style="color:#0b1120;">Devis ${quote.quoteNumber}</h1>
                        <p>Bonjour ${quote.client.name || ''},</p>
                        <p>Veuillez trouver ci-joint votre devis pour un montant de <strong>${quote.total.toFixed(2)} €</strong>.</p>
                        <p>Cordialement,<br>${company.companyName || ''}</p>
                    </div>
                `,
                attachments: [{
                    filename: `devis_${quote.quoteNumber}.pdf`,
                    content: Buffer.from(pdfBytes).toString('base64'),
                    contentType: 'application/pdf'
                }]
            });

            if (error) throw new Error(error.message || 'Erreur envoi email');

            // Sauvegarder l'email dans le devis si absent
            await pool.query(
                'UPDATE quotes SET client_email = COALESCE(client_email, $1), status = CASE WHEN status = \'draft\' THEN \'sent\' ELSE status END WHERE id = $2 AND user_id = $3',
                [email, quoteId, userId]
            );

            return { quoteId, email, sent: true };
        }
    },

    // ----------------------------------------------------------
    // SAUVEGARDER UNE PRÉFÉRENCE
    // ----------------------------------------------------------
    save_preference: {
        label: 'Sauvegarder une préférence',
        async prepare(args, userId) {
            if (!args.preference || !args.value) {
                throw new Error('Précisez la préférence et sa valeur (ex: "taux horaire par défaut 50€").');
            }

            const prefKey = String(args.preference).toLowerCase().trim();
            const validPrefs = {
                'taux horaire': 'defaultHourlyRate',
                'taux horaire par défaut': 'defaultHourlyRate',
                'hourly rate': 'defaultHourlyRate',
                'marge': 'defaultMarginPercent',
                'marge par défaut': 'defaultMarginPercent',
                'tva': 'defaultVatRate',
                'taux tva': 'defaultVatRate',
                'régime tva': 'defaultVatRegime',
                'regime tva': 'defaultVatRegime',
                'conditions de paiement': 'defaultPaymentTerms',
                'délai de paiement': 'defaultPaymentTerms',
                'delai de paiement': 'defaultPaymentTerms'
            };

            const mappedKey = validPrefs[prefKey];
            if (!mappedKey) {
                throw new Error(`Préférence non reconnue : "${args.preference}". Valeurs possibles : taux horaire, marge, TVA, régime TVA, conditions de paiement.`);
            }

            let parsedValue = args.value;

            if (mappedKey === 'defaultHourlyRate' || mappedKey === 'defaultMarginPercent' || mappedKey === 'defaultVatRate') {
                parsedValue = parseFloat(String(args.value).replace(',', '.'));
                if (isNaN(parsedValue) || parsedValue < 0) {
                    throw new Error(`Valeur numérique invalide : "${args.value}"`);
                }
            } else if (mappedKey === 'defaultPaymentTerms') {
                parsedValue = parseInt(String(args.value).replace(/\D/g, ''));
                if (isNaN(parsedValue) || parsedValue < 0) {
                    throw new Error(`Délai invalide : "${args.value}"`);
                }
            } else if (mappedKey === 'defaultVatRegime') {
                const v = String(args.value).toLowerCase();
                if (v.includes('franchise')) parsedValue = 'franchise';
                else if (v.includes('assujetti')) parsedValue = 'assujetti';
                else throw new Error('Régime TVA invalide. Utilisez "franchise" ou "assujetti".');
            }

            const labels = {
                defaultHourlyRate: 'Taux horaire par défaut',
                defaultMarginPercent: 'Marge par défaut',
                defaultVatRate: 'Taux de TVA par défaut',
                defaultVatRegime: 'Régime TVA par défaut',
                defaultPaymentTerms: 'Conditions de paiement'
            };

            const unit = {
                defaultHourlyRate: ' €/h',
                defaultMarginPercent: ' %',
                defaultVatRate: ' %',
                defaultVatRegime: '',
                defaultPaymentTerms: ' jours'
            };

            return {
                type: 'save_preference',
                summary: `Sauvegarder la préférence "${labels[mappedKey]}"`,
                preview: {
                    'Préférence': labels[mappedKey],
                    'Nouvelle valeur': `${parsedValue}${unit[mappedKey]}`
                },
                payload: {
                    preferenceKey: mappedKey,
                    value: parsedValue
                }
            };
        },
        async execute(args, userId) {
            const { updateUserPreferences } = require('./preferences');
            const updates = {};
            updates[args.preferenceKey] = args.value;
            const success = await updateUserPreferences(userId, updates);
            if (!success) {
                throw new Error('Impossible de sauvegarder la préférence.');
            }
            return {
                preferenceKey: args.preferenceKey,
                value: args.value
            };
        }
    },

    // ----------------------------------------------------------
    // CHANGER LE STATUT D'UN DEVIS
    // ----------------------------------------------------------
    change_quote_status: {
        label: 'Changer le statut d\'un devis',
        async prepare(args, userId) {
            const status = String(args.status || '').toLowerCase();
            const statusMap = {
                'brouillon': 'draft', 'draft': 'draft',
                'envoyé': 'sent', 'envoye': 'sent', 'sent': 'sent',
                'accepté': 'accepted', 'accepte': 'accepted', 'accepted': 'accepted',
                'refusé': 'refused', 'refuse': 'refused', 'refused': 'refused'
            };
            const finalStatus = statusMap[status];
            if (!finalStatus) {
                throw new Error('Statut invalide. Utilisez : brouillon, envoyé, accepté, ou refusé.');
            }

            // Trouver le devis
            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé.');

            const labels = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé' };

            return {
                type: 'change_quote_status',
                summary: `Changer le statut du devis ${quote.quote_number}`,
                preview: {
                    'Devis': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Ancien statut': labels[quote.status] || quote.status || 'Brouillon',
                    'Nouveau statut': labels[finalStatus]
                },
                payload: { quoteId: quote.id, status: finalStatus }
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                UPDATE quotes
                SET status = $1, updated_at = NOW()
                WHERE id = $2 AND user_id = $3
                RETURNING id, quote_number, status
            `, [args.status, args.quoteId, userId]);

            if (result.rows.length === 0) throw new Error('Devis introuvable.');
            return {
                quoteId: result.rows[0].id,
                quoteNumber: result.rows[0].quote_number,
                status: result.rows[0].status
            };
        }
    },

    // ----------------------------------------------------------
    // SUPPRIMER UN DEVIS
    // ----------------------------------------------------------
    delete_quote: {
        label: 'Supprimer un devis',
        async prepare(args, userId) {
            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT id, quote_number, client_name, total FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT id, quote_number, client_name, total FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT id, quote_number, client_name, total FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé.');

            return {
                type: 'delete_quote',
                summary: `Supprimer le devis ${quote.quote_number}`,
                preview: {
                    'Devis': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Total': parseFloat(quote.total).toFixed(2) + ' €',
                    '⚠️': 'Cette action est irréversible'
                },
                payload: { quoteId: quote.id, quoteNumber: quote.quote_number }
            };
        },
        async execute(args, userId) {
            const result = await pool.query(
                'DELETE FROM quotes WHERE id = $1 AND user_id = $2 RETURNING id, quote_number',
                [args.quoteId, userId]
            );
            if (result.rows.length === 0) throw new Error('Devis introuvable.');
            return { quoteId: result.rows[0].id, quoteNumber: result.rows[0].quote_number, deleted: true };
        }
    },

    // ----------------------------------------------------------
    // DUPLIQUER UN DEVIS
    // ----------------------------------------------------------
    duplicate_quote: {
        label: 'Dupliquer un devis',
        async prepare(args, userId) {
            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                // 🆕 Utilise la résolution relative
                quote = await resolveQuoteReference(userId, args.quoteRef || 'dernier');
                // const res = await pool.query(
                //     'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                //     [userId]
                // );
                // if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé à dupliquer.');

            return {
                type: 'duplicate_quote',
                summary: `Dupliquer le devis ${quote.quote_number}`,
                preview: {
                    'Devis source': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Total': parseFloat(quote.total).toFixed(2) + ' €',
                    'Résultat': 'Un nouveau brouillon sera créé'
                },
                payload: { quoteId: quote.id }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const srcResult = await client.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [args.quoteId, userId]
                );
                if (srcResult.rows.length === 0) throw new Error('Devis introuvable.');
                const src = srcResult.rows[0];

                // Nouveau numéro
                const counterResult = await client.query(
                    'SELECT last_number FROM counters WHERE user_id = $1',
                    [userId]
                );
                let newNumber = 1;
                if (counterResult.rows.length > 0) {
                    newNumber = counterResult.rows[0].last_number + 1;
                    await client.query('UPDATE counters SET last_number = $1 WHERE user_id = $2', [newNumber, userId]);
                } else {
                    await client.query('INSERT INTO counters (user_id, last_number) VALUES ($1, 1)', [userId]);
                }
                const newQuoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

                const issueDate = new Date().toISOString().slice(0, 10);
                const validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + 30);
                const validDate = validUntil.toISOString().slice(0, 10);

                const insertResult = await client.query(`
                    INSERT INTO quotes (
                        user_id, quote_number, issue_date, valid_date,
                        subtotal, vat_amount, total, vat_regime, status, items,
                        client_id, client_name, client_address, client_vat, client_email
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, $14)
                    RETURNING id, quote_number
                `, [
                    userId, newQuoteNumber, issueDate, validDate,
                    src.subtotal, src.vat_amount, src.total, src.vat_regime,
                    JSON.stringify(src.items), src.client_id, src.client_name, src.client_address,
                    src.client_vat, src.client_email
                ]);

                await client.query('COMMIT');
                return {
                    id: insertResult.rows[0].id,
                    quoteNumber: insertResult.rows[0].quote_number,
                    sourceQuoteNumber: src.quote_number
                };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },

    // ----------------------------------------------------------
    // TRANSFORMER UN DEVIS EN FACTURE
    // ----------------------------------------------------------
    convert_quote_to_invoice: {
        label: 'Transformer un devis en facture',
        async prepare(args, userId) {
            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    "SELECT * FROM quotes WHERE user_id = $1 AND status IN ('accepted','sent') ORDER BY created_at DESC LIMIT 1",
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé (accepté ou envoyé).');

            return {
                type: 'convert_quote_to_invoice',
                summary: `Transformer le devis ${quote.quote_number} en facture`,
                preview: {
                    'Devis source': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Total': parseFloat(quote.total).toFixed(2) + ' €',
                    'Résultat': 'Une nouvelle facture brouillon sera créée'
                },
                payload: { quoteId: quote.id }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const qResult = await client.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [args.quoteId, userId]
                );
                if (qResult.rows.length === 0) throw new Error('Devis introuvable.');
                const quote = qResult.rows[0];

                // Récupérer les settings (préfixe + délai paiement)
                const settingsResult = await client.query(
                    'SELECT invoice_prefix, payment_terms, vat_rate FROM settings WHERE user_id = $1',
                    [userId]
                );
                const prefix = settingsResult.rows[0]?.invoice_prefix || 'FAC';
                const defaultTerms = settingsResult.rows[0]?.payment_terms || 30;
                const vatRate = parseFloat(settingsResult.rows[0]?.vat_rate) || 21;

                // Nouveau numéro de facture
                const counterResult = await client.query(
                    'SELECT last_number FROM invoice_counters WHERE user_id = $1',
                    [userId]
                );
                let newNumber = 1;
                if (counterResult.rows.length > 0) {
                    newNumber = counterResult.rows[0].last_number + 1;
                    await client.query('UPDATE invoice_counters SET last_number = $1 WHERE user_id = $2', [newNumber, userId]);
                } else {
                    await client.query('INSERT INTO invoice_counters (user_id, last_number) VALUES ($1, 1)', [userId]);
                }
                const invoiceNumber = `${prefix}-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

                const issueDate = new Date().toISOString().slice(0, 10);
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + defaultTerms);
                const dueDateStr = dueDate.toISOString().slice(0, 10);

                const result = await client.query(`
                    INSERT INTO invoices (
                        user_id, invoice_number, quote_id, issue_date, due_date,
                        subtotal, vat_amount, total, vat_regime, status,
                        items, client_id, client_name, client_address, client_vat, client_email
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $13, $14, $15)
                    RETURNING id, invoice_number
                `, [
                    userId, invoiceNumber, quote.id, issueDate, dueDateStr,
                    quote.subtotal, quote.vat_amount, quote.total, quote.vat_regime,
                    JSON.stringify(quote.items), quote.client_id, quote.client_name, quote.client_address,
                    quote.client_vat, quote.client_email
                ]);

                await client.query('COMMIT');
                return {
                    id: result.rows[0].id,
                    invoiceNumber: result.rows[0].invoice_number,
                    sourceQuoteNumber: quote.quote_number
                };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },

    // ----------------------------------------------------------
    // MARQUER UNE FACTURE PAYÉE
    // ----------------------------------------------------------
    mark_invoice_paid: {
        label: 'Marquer une facture payée',
        async prepare(args, userId) {
            let invoice = null;
            if (args.invoiceId) {
                const res = await pool.query(
                    'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
                    [parseInt(args.invoiceId), userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            } else if (args.invoiceNumber) {
                const res = await pool.query(
                    'SELECT * FROM invoices WHERE invoice_number = $1 AND user_id = $2',
                    [args.invoiceNumber, userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            } else {
                const res = await pool.query(
                    "SELECT * FROM invoices WHERE user_id = $1 AND status != 'paid' ORDER BY created_at DESC LIMIT 1",
                    [userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            }
            if (!invoice) throw new Error('Aucune facture trouvée.');

            return {
                type: 'mark_invoice_paid',
                summary: `Marquer la facture ${invoice.invoice_number} comme payée`,
                preview: {
                    'Facture': invoice.invoice_number,
                    'Client': invoice.client_name || '—',
                    'Total': parseFloat(invoice.total).toFixed(2) + ' €',
                    'Mode de paiement': args.paymentMethod || 'virement'
                },
                payload: {
                    invoiceId: invoice.id,
                    paymentMethod: args.paymentMethod || 'virement'
                }
            };
        },
        async execute(args, userId) {
            const result = await pool.query(`
                UPDATE invoices
                SET status = 'paid', paid_at = NOW(), payment_method = $1, updated_at = NOW()
                WHERE id = $2 AND user_id = $3
                RETURNING id, invoice_number, status
            `, [args.paymentMethod, args.invoiceId, userId]);

            if (result.rows.length === 0) throw new Error('Facture introuvable.');
            return {
                invoiceId: result.rows[0].id,
                invoiceNumber: result.rows[0].invoice_number,
                status: result.rows[0].status
            };
        }
    },

    // ----------------------------------------------------------
    // ENVOYER UNE FACTURE PAR EMAIL
    // ----------------------------------------------------------
    send_invoice_email: {
        label: 'Envoyer une facture par email',
        async prepare(args, userId) {
            let invoice = null;
            if (args.invoiceId) {
                const res = await pool.query(
                    'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
                    [parseInt(args.invoiceId), userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            } else if (args.invoiceNumber) {
                const res = await pool.query(
                    'SELECT * FROM invoices WHERE invoice_number = $1 AND user_id = $2',
                    [args.invoiceNumber, userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) invoice = res.rows[0];
            }
            if (!invoice) throw new Error('Aucune facture trouvée.');

            const email = args.email || invoice.client_email;
            if (!email) {
                throw new Error(`Aucun email pour cette facture. Précisez : "envoie la facture à client@test.com".`);
            }

            return {
                type: 'send_invoice_email',
                summary: `Envoyer la facture ${invoice.invoice_number} à ${email}`,
                preview: {
                    'Facture': invoice.invoice_number,
                    'Client': invoice.client_name || '—',
                    'Destinataire': email,
                    'Total': parseFloat(invoice.total).toFixed(2) + ' €'
                },
                payload: {
                    invoiceId: invoice.id,
                    email,
                    invoiceData: {
                        items: invoice.items,
                        subtotal: parseFloat(invoice.subtotal) || 0,
                        vatAmount: parseFloat(invoice.vat_amount) || 0,
                        total: parseFloat(invoice.total),
                        vatRegime: invoice.vat_regime,
                        invoiceNumber: invoice.invoice_number,
                        issueDate: invoice.issue_date,
                        dueDate: invoice.due_date,
                        status: invoice.status,
                        notes: invoice.notes,
                        client: {
                            name: invoice.client_name,
                            address: invoice.client_address,
                            vat: invoice.client_vat,
                            email: invoice.client_email
                        }
                    }
                }
            };
        },
        async execute(args, userId) {
            const { Resend } = require('resend');
            const { generateInvoicePDF } = require('../pdf-generator-invoice');

            const settingsResult = await pool.query(
                'SELECT * FROM settings WHERE user_id = $1',
                [userId]
            );
            const s = settingsResult.rows[0] || {};
            const inv = args.invoiceData;

            const company = {
                companyName: s.company_name, address: s.address, siret: s.siret,
                tva: s.tva, phone: s.phone, email: s.email, website: s.website,
                logo: s.logo, iban: s.iban, bic: s.bic, bank_name: s.bank_name,
                vatRegime: s.vat_regime, vatRate: parseFloat(s.vat_rate) || 21
            };

            const pdfBytes = await generateInvoicePDF(
                inv.items, inv.subtotal, inv.vatAmount, inv.total,
                inv.vatRegime, company.vatRate,
                inv.invoiceNumber, inv.issueDate, inv.dueDate,
                inv.status, inv.notes,
                company, inv.client,
                s.language || 'fr', s.pdf_template || 'classic'
            );

            const resend = new Resend(process.env.RESEND_API_KEY);
            const { error } = await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
                to: [args.email],
                subject: `Votre facture ${inv.invoiceNumber}`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                        <h1 style="color:#0b1120;">Facture ${inv.invoiceNumber}</h1>
                        <p>Bonjour ${inv.client.name || ''},</p>
                        <p>Veuillez trouver ci-joint votre facture d'un montant de <strong>${inv.total.toFixed(2)} €</strong>.</p>
                        <p>Échéance : ${inv.dueDate}</p>
                        <p>Cordialement,<br>${company.companyName || ''}</p>
                    </div>
                `,
                attachments: [{
                    filename: `facture_${inv.invoiceNumber}.pdf`,
                    content: Buffer.from(pdfBytes).toString('base64'),
                    contentType: 'application/pdf'
                }]
            });

            if (error) throw new Error(error.message || 'Erreur envoi email');

            await pool.query(
                'UPDATE invoices SET client_email = COALESCE(client_email, $1), status = CASE WHEN status = \'draft\' THEN \'sent\' ELSE status END, updated_at = NOW() WHERE id = $2 AND user_id = $3',
                [args.email, args.invoiceId, userId]
            );

            return { invoiceId: args.invoiceId, email: args.email, sent: true };
        }
    },

    // ----------------------------------------------------------
    // AJOUTER DES LIGNES À UN DEVIS
    // ----------------------------------------------------------
    add_items_to_quote: {
        label: 'Ajouter des lignes à un devis',
        async prepare(args, userId) {
            if (!args.items || !Array.isArray(args.items) || args.items.length === 0) {
                throw new Error('Aucun article à ajouter.');
            }

            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else if (args.quoteNumber) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE quote_number = $1 AND user_id = $2',
                    [args.quoteNumber, userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé.');

            // Normaliser les nouveaux items
            const newItems = args.items.map(it => {
                const qty = parseFloat(it.qty) || 1;
                const unitPrice = parseFloat(it.unitPrice) || 0;
                return {
                    ref: it.ref || 'EXT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
                    name: it.name || 'Article',
                    qty,
                    unitPrice,
                    total: Math.round(qty * unitPrice * 100) / 100
                };
            });

            return {
                type: 'add_items_to_quote',
                summary: `Ajouter ${newItems.length} ligne(s) au devis ${quote.quote_number}`,
                preview: {
                    'Devis': quote.quote_number,
                    'Client': quote.client_name || '—',
                    'Nouvelles lignes': newItems.map(i => `${i.qty}× ${i.name}`).join(', ').slice(0, 100),
                    'Total actuel': parseFloat(quote.total).toFixed(2) + ' €'
                },
                payload: { quoteId: quote.id, newItems }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const qResult = await client.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [args.quoteId, userId]
                );
                if (qResult.rows.length === 0) throw new Error('Devis introuvable.');
                const quote = qResult.rows[0];

                const currentItems = Array.isArray(quote.items) ? quote.items : [];
                const mergedItems = [...currentItems, ...args.newItems];

                const subtotal = mergedItems.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);
                const vatRate = parseFloat(await getVatRate(client, userId));
                const vatAmount = quote.vat_regime === 'assujetti' ? Math.round(subtotal * (vatRate / 100) * 100) / 100 : 0;
                const total = Math.round((subtotal + vatAmount) * 100) / 100;

                await client.query(`
                    UPDATE quotes
                    SET items = $1, subtotal = $2, vat_amount = $3, total = $4, updated_at = NOW()
                    WHERE id = $5 AND user_id = $6
                `, [JSON.stringify(mergedItems), subtotal, vatAmount, total, args.quoteId, userId]);

                await client.query('COMMIT');
                return {
                    quoteId: args.quoteId,
                    quoteNumber: quote.quote_number,
                    itemsCount: mergedItems.length,
                    addedCount: args.newItems.length,
                    subtotal, vatAmount, total
                };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },

    // ----------------------------------------------------------
    // RETIRER UNE LIGNE D'UN DEVIS
    // ----------------------------------------------------------
    remove_item_from_quote: {
        label: 'Retirer une ligne d\'un devis',
        async prepare(args, userId) {
            const itemRef = args.itemRef || args.ref;
            const itemName = args.itemName || args.name;
            if (!itemRef && !itemName) {
                throw new Error('Précisez l\'article à retirer (référence ou nom).');
            }

            let quote = null;
            if (args.quoteId) {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [parseInt(args.quoteId), userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            } else {
                const res = await pool.query(
                    'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                    [userId]
                );
                if (res.rows.length > 0) quote = res.rows[0];
            }
            if (!quote) throw new Error('Aucun devis trouvé.');

            const items = Array.isArray(quote.items) ? quote.items : [];
            const idx = items.findIndex(it => {
                if (itemRef && it.ref && it.ref.toLowerCase() === String(itemRef).toLowerCase()) return true;
                if (itemName && it.name && it.name.toLowerCase().includes(String(itemName).toLowerCase())) return true;
                return false;
            });
            if (idx === -1) throw new Error('Aucune ligne ne correspond à cet article.');

            const removed = items[idx];

            return {
                type: 'remove_item_from_quote',
                summary: `Retirer "${removed.name}" du devis ${quote.quote_number}`,
                preview: {
                    'Devis': quote.quote_number,
                    'Article à retirer': removed.name,
                    'Quantité': removed.qty,
                    'Montant': parseFloat(removed.total).toFixed(2) + ' €'
                },
                payload: { quoteId: quote.id, itemIndex: idx }
            };
        },
        async execute(args, userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const qResult = await client.query(
                    'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
                    [args.quoteId, userId]
                );
                if (qResult.rows.length === 0) throw new Error('Devis introuvable.');
                const quote = qResult.rows[0];

                const items = Array.isArray(quote.items) ? quote.items : [];
                if (args.itemIndex < 0 || args.itemIndex >= items.length) throw new Error('Index invalide.');
                items.splice(args.itemIndex, 1);

                const subtotal = items.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);
                const vatRate = parseFloat(await getVatRate(client, userId));
                const vatAmount = quote.vat_regime === 'assujetti' ? Math.round(subtotal * (vatRate / 100) * 100) / 100 : 0;
                const total = Math.round((subtotal + vatAmount) * 100) / 100;

                await client.query(`
                    UPDATE quotes
                    SET items = $1, subtotal = $2, vat_amount = $3, total = $4, updated_at = NOW()
                    WHERE id = $5 AND user_id = $6
                `, [JSON.stringify(items), subtotal, vatAmount, total, args.quoteId, userId]);

                await client.query('COMMIT');
                return {
                    quoteId: args.quoteId,
                    quoteNumber: quote.quote_number,
                    itemsCount: items.length,
                    subtotal, vatAmount, total
                };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    },
};

module.exports = { ACTIONS, parseDateNatural, getVatRate, resolveQuoteReference, resolveInvoiceReference };