require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Resend } = require('resend');

const { pool, initDB } = require('./db');
const { authenticateToken } = require('./middleware/auth');

const { extractTextFromFile } = require('./utils/parser');
const { extractItemsFromText } = require('./utils/extractor');
const { generateQuotePDF } = require('./utils/pdf-generator');
const { checkAndIncrementQuota } = require('./utils/quota');
const authRoutes = require('./routes/auth');
const { router: stripeRoutes, stripeWebhook } = require('./routes/stripe');
const productsRoutes = require('./routes/products');
const clientsRoutes = require('./routes/clients');
const quotesRoutes = require('./routes/quotes');
const adminRoutes = require('./routes/admin');
const teamRoutes = require('./routes/team');
const invoicesRoutes = require('./routes/invoices');
const servicesRoutes = require('./routes/services');
const suppliersRoutes = require('./routes/suppliers');

// ⚙️ INTERRUPTEUR DE QUOTA — Mets à `false` pour désactiver les limites pendant les tests
const ENABLE_QUOTA_LIMITS = false;

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1); // Trust Render's proxy (needed for req.protocol = https)

// Webhook Stripe: a besoin du body brut pour vérifier la signature
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes publiques
app.use('/api/auth', authRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/suppliers', suppliersRoutes);

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// GET /api/settings
// ============================================================
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            await pool.query('INSERT INTO settings (user_id) VALUES ($1)', [req.user.id]);
            return res.json({ companyName: 'Votre Entreprise', vatRegime: 'franchise', vatRate: 21 });
        }
        const s = result.rows[0];
        res.json({
            companyName: s.company_name,
            address: s.address,
            siret: s.siret,
            tva: s.tva,
            phone: s.phone,
            email: s.email,
            website: s.website,
            logo: s.logo,
            vatRegime: s.vat_regime || 'franchise',
            vatRate: parseFloat(s.vat_rate) || 21,
            signatureMethod: s.signature_method || 'none',
            iban: s.iban,
            bic: s.bic,
            bankName: s.bank_name,
            invoicePrefix: s.invoice_prefix || 'FAC',
            paymentTerms: s.payment_terms || 30,
            language: s.language || 'fr',
            pdfTemplate: s.pdf_template || 'classic'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/settings
// ============================================================
app.post('/api/settings', authenticateToken, async (req, res) => {
        const { companyName, address, siret, tva, phone, email, website, logo, vatRegime, vatRate, signatureMethod, iban, bic, bankName, invoicePrefix, paymentTerms, language, pdfTemplate } = req.body;
    try {
        await pool.query(`
            INSERT INTO settings (
                user_id, company_name, address, siret, tva, phone, email, website,
                logo, vat_regime, vat_rate, signature_method,
                iban, bic, bank_name, invoice_prefix, payment_terms, language, pdf_template,
                updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19,
                NOW()
            )
            ON CONFLICT (user_id) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                address = EXCLUDED.address,
                siret = EXCLUDED.siret,
                tva = EXCLUDED.tva,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                website = EXCLUDED.website,
                logo = COALESCE(EXCLUDED.logo, settings.logo),
                vat_regime = EXCLUDED.vat_regime,
                vat_rate = EXCLUDED.vat_rate,
                signature_method = EXCLUDED.signature_method,
                iban = EXCLUDED.iban,
                bic = EXCLUDED.bic,
                bank_name = EXCLUDED.bank_name,
                invoice_prefix = EXCLUDED.invoice_prefix,
                payment_terms = EXCLUDED.payment_terms,
                language = EXCLUDED.language,
                pdf_template = EXCLUDED.pdf_template,
                updated_at = NOW()
        `, [
            req.user.id,
            companyName,
            address,
            siret,
            tva,
            phone,
            email,
            website,
            logo,
            vatRegime || 'franchise',
            vatRate || 21,
            signatureMethod || 'none',
            iban || null,
            bic || null,
            bankName || null,
            invoicePrefix || 'FAC',
            paymentTerms || 30,
            language || 'fr',
            pdfTemplate || 'classic'
        ]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde.' });
    }
});

// ============================================================
// GET /api/history
// ============================================================
app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
            [req.user.id]
        );
        const history = result.rows.map(r => ({
            id: r.id,
            quoteNumber: r.quote_number,
            issueDate: r.issue_date,
            validDate: r.valid_date,
            subtotal: parseFloat(r.subtotal) || 0,
            vatAmount: parseFloat(r.vat_amount) || 0,
            total: parseFloat(r.total),
            vatRegime: r.vat_regime,
            status: r.status || 'draft',
            items: r.items,
            clientId: r.client_id,
            clientName: r.client_name,
            clientAddress: r.client_address,
            clientEmail: r.client_email,
            publicToken: r.public_token,
            sentToClientAt: r.sent_to_client_at,
            clientViewedAt: r.client_viewed_at,
            signature: r.signature_signed_at ? {
                method: r.signature_method,
                signedAt: r.signature_signed_at,
                signedBy: r.signature_signed_by
            } : null
        }));
        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/generate-quote
// ============================================================
app.post('/api/generate-quote', authenticateToken, upload.single('file'), async (req, res) => {
    const logs = [];
    try {
        // 1. Vérifier le quota AVANT de traiter le fichier // mettre quota a true en haut du fichier pour etre traiter 
        if (ENABLE_QUOTA_LIMITS) {
            const quota = await checkAndIncrementQuota(req.user.id);
            if (!quota.allowed) {
                if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    error: quota.message,
                    quota: { plan: quota.plan, limit: quota.limit, used: quota.used }
                });
            }
        }
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
        const filePath = req.file.path;
        const mimeType = req.file.mimetype;

        const clientId = req.body.clientId ? parseInt(req.body.clientId) : null;
        const clientName = req.body.clientName || '';
        const clientAddress = req.body.clientAddress || '';
        const clientVat = req.body.clientVat || '';
        const clientEmail = req.body.clientEmail || '';

        logs.push(`Fichier reçu : ${req.file.originalname}`);
        const text = await extractTextFromFile(filePath, mimeType);
        if (!text || text.trim().length < 10) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Fichier vide ou illisible.' });
        }
        logs.push(`Texte extrait (${text.length} caractères).`);

        // Charger produits ET services du catalogue
        const productsResult = await pool.query(
            'SELECT ref, name, unit_price FROM products WHERE user_id = $1',
            [req.user.id]
        );
        const servicesResult = await pool.query(
            'SELECT ref, name, unit_price FROM services WHERE user_id = $1 AND active = TRUE',
            [req.user.id]
        );

        const userProducts = [
            ...productsResult.rows.map(p => ({
                ref: p.ref,
                name: p.name,
                unitPrice: parseFloat(p.unit_price),
                type: 'product'
            })),
            ...servicesResult.rows.map(s => ({
                ref: s.ref,
                name: s.name,
                unitPrice: parseFloat(s.unit_price),
                type: 'service'
            }))
        ];

        const result = await extractItemsFromText(text, userProducts);
        const items = result.items;
        const iaLogs = result.logs || [];
        fs.unlinkSync(filePath);

        // ---- Calcul HT ----
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);

        // ---- CHARGEMENT DES PARAMÈTRES (AVANT le calcul de TVA) ----
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const s = settingsResult.rows[0] || {};

        const vatRegime = s.vat_regime || 'franchise';
        const vatRate = parseFloat(s.vat_rate) || 21;

        // ---- Calcul TVA et TTC ----
        const vatAmount = vatRegime === 'assujetti' ? subtotal * (vatRate / 100) : 0;
        const total = subtotal + vatAmount;

        logs.push(`Total HT : ${subtotal.toFixed(2)} €`);
        if (vatRegime === 'assujetti') {
            logs.push(`TVA (${vatRate}%) : ${vatAmount.toFixed(2)} €`);
            logs.push(`Total TTC : ${total.toFixed(2)} €`);
        } else {
            logs.push(`Franchise de TVA : pas de TVA appliquée.`);
        }

        // ---- Numéro de devis unique par utilisateur ----
        const counterResult = await pool.query(
            'SELECT last_number FROM counters WHERE user_id = $1',
            [req.user.id]
        );
        let newNumber = 1;
        if (counterResult.rows.length > 0) {
            newNumber = counterResult.rows[0].last_number + 1;
            await pool.query(
                'UPDATE counters SET last_number = $1 WHERE user_id = $2',
                [newNumber, req.user.id]
            );
        } else {
            await pool.query(
                'INSERT INTO counters (user_id, last_number) VALUES ($1, 1)',
                [req.user.id]
            );
        }
        const quoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const validDate = validUntil.toISOString().slice(0, 10);

        // ---- Objet company (utilise le `s` déjà chargé plus haut) ----
        const company = {
            companyName: s.company_name,
            address: s.address,
            siret: s.siret,
            tva: s.tva,
            phone: s.phone,
            email: s.email,
            website: s.website,
            logo: s.logo,
            vatRegime,
            vatRate
        };

        // ---- Insertion du devis en base ----
        await pool.query(`
            INSERT INTO quotes (user_id, quote_number, issue_date, valid_date, subtotal, vat_amount, total, vat_regime, status, items, client_id, client_name, client_address, client_vat, client_email)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, $14)
        `, [req.user.id, quoteNumber, issueDate, validDate, subtotal, vatAmount, total, vatRegime,
            JSON.stringify(items), clientId, clientName, clientAddress, clientVat, clientEmail]);

        // Récupérer l'id du devis qu'on vient d'insérer
        const insertedQuote = await pool.query(
            'SELECT id FROM quotes WHERE user_id = $1 AND quote_number = $2',
            [req.user.id, quoteNumber]
        );
        const quoteId = insertedQuote.rows[0]?.id || null;

        res.json({
            id: quoteId,
            items, subtotal, vatAmount, total,
            vatRegime, vatRate,
            status: 'draft',
            logs: [...logs, ...iaLogs],
            quoteNumber, issueDate, validDate,
            company,
            client: { name: clientName, address: clientAddress, vat: clientVat, email: clientEmail }
        });
    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: error.message || 'Erreur interne' });
    }
});

// ============================================================
// GET /api/download-pdf
// ============================================================
app.post('/api/download-pdf', authenticateToken, async (req, res) => {
    try {
        const { items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client, signature, lang, template } = req.body;

        // Si la langue n'est pas spécifiée, on la lit dans les settings
        let finalLang = lang;
        let finalTemplate = template;
        if (!finalLang || !finalTemplate) {
            const settingsRes = await pool.query('SELECT language, pdf_template FROM settings WHERE user_id = $1', [req.user.id]);
            if (!finalLang) finalLang = settingsRes.rows[0]?.language || 'fr';
            if (!finalTemplate) finalTemplate = settingsRes.rows[0]?.pdf_template || 'classic';
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Aucun article' });
        }

        const pdfBytes = await generateQuotePDF(
            items, subtotal, vatAmount, total,
            vatRegime, vatRate, quoteNumber, issueDate, validDate,
            company, client, signature, finalLang, finalTemplate
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=devis_${quoteNumber}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Erreur PDF:', err);
        res.status(500).json({ error: 'Erreur génération PDF : ' + err.message });
    }
});
// app.post('/api/download-pdf', authenticateToken, async (req, res) => {
//     try {
//         const dataParam = req.query.data;
//         if (!dataParam) return res.status(400).send('Données manquantes');
//         const data = JSON.parse(dataParam);
//         const { items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client, signature } = data;

//         if (!items || items.length === 0) return res.status(400).send('Aucun article');

//         const pdfBytes = await generateQuotePDF(
//             items, subtotal, vatAmount, total,
//             vatRegime, vatRate, quoteNumber, issueDate, validDate,
//             company, client, signature
//         );
//         res.setHeader('Content-Type', 'application/pdf');
//         res.setHeader('Content-Disposition', `attachment; filename=devis_${quoteNumber}.pdf`);
//         res.send(Buffer.from(pdfBytes));
//     } catch (err) {
//         console.error(err);
//         res.status(500).send('Erreur génération PDF');
//     }
// });
// ============================================================
// POST /api/send-email
// ============================================================
app.post('/api/send-email', authenticateToken, async (req, res) => {
    try {
        const { email, items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client, signature } = req.body;
        if (!email || !items || items.length === 0) {
            return res.status(400).json({ error: 'Email et articles requis.' });
        }

        const settingsLangRes = await pool.query('SELECT language FROM settings WHERE user_id = $1', [req.user.id]);
        const mailLang = settingsLangRes.rows[0]?.language || 'fr';
        
        const settingsTplRes = await pool.query('SELECT pdf_template FROM settings WHERE user_id = $1', [req.user.id]);
        const mailTemplate = settingsTplRes.rows[0]?.pdf_template || 'classic';
        const pdfBytes = await generateQuotePDF(
            items, subtotal, vatAmount, total, vatRegime, vatRate,
            quoteNumber, issueDate, validDate, company, client, signature, mailLang, mailTemplate
        );
        const resend = new Resend(process.env.RESEND_API_KEY);

        const vatLine = vatRegime === 'assujetti'
            ? `<p>TVA (${vatRate}%) : <strong>${vatAmount.toFixed(2)} €</strong></p>`
            : '';

        const htmlContent = `
            <h1>Devis ${quoteNumber}</h1>
            <p>Bonjour ${client?.name || ''},</p>
            <p>Veuillez trouver ci-joint votre devis :</p>
            <p>Total HT : <strong>${subtotal.toFixed(2)} €</strong></p>
            ${vatLine}
            <p>Total TTC : <strong>${total.toFixed(2)} €</strong></p>
            <p>Date d'émission : ${issueDate}</p>
            <p>Date de validité : ${validDate}</p>
            <br>
            <p>${company.companyName || ''}</p>
        `;

        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Devis <noreply@votreentreprise.com>',
            to: [email],
            subject: `Votre devis ${quoteNumber}`,
            html: htmlContent,
            attachments: [{
                filename: `devis_${quoteNumber}.pdf`,
                content: Buffer.from(pdfBytes).toString('base64'),
                contentType: 'application/pdf'
            }]
        });

        if (error) return res.status(500).json({ error: error.message });

        await pool.query(
            'UPDATE quotes SET client_email = $1 WHERE user_id = $2 AND quote_number = $3',
            [email, req.user.id, quoteNumber]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Erreur envoi' });
    }
});

// ============================================================
// GET /api/dashboard
// ==================
// ============================================================
// POST /api/quotes/:id/sign — Enregistrer la signature d'un devis
// ============================================================
app.post('/api/quotes/:id/sign', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    const { method, signedBy, signatureData, accepted } = req.body;

    if (!['checkbox', 'draw'].includes(method)) {
        return res.status(400).json({ error: 'Méthode de signature invalide.' });
    }
    if (!signedBy || !signedBy.trim()) {
        return res.status(400).json({ error: 'Le nom du signataire est requis.' });
    }
    if (method === 'checkbox' && !accepted) {
        return res.status(400).json({ error: 'Vous devez accepter les conditions.' });
    }
    if (method === 'draw' && (!signatureData || signatureData.length < 100)) {
        return res.status(400).json({ error: 'La signature est vide.' });
    }

    try {
        // Récupérer l'IP
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

        const result = await pool.query(`
            UPDATE quotes
            SET signature_method = $1,
                signature_data = $2,
                signature_signed_at = NOW(),
                signature_signed_by = $3,
                signature_ip = $4,
                status = 'accepted',
                updated_at = NOW()
            WHERE id = $5 AND user_id = $6
            RETURNING id, quote_number, signature_signed_at, status
        `, [
            method,
            method === 'draw' ? signatureData : null,
            signedBy.trim(),
            ip,
            quoteId,
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Devis non trouvé.' });
        }

        res.json({
            success: true,
            quote: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur signature:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// POST /api/quotes/:id/send-to-client
// Génère un token public et envoie le lien au client par email
// ============================================================
app.post('/api/quotes/:id/send-to-client', authenticateToken, async (req, res) => {
    const quoteId = parseInt(req.params.id);
    if (!quoteId) return res.status(400).json({ error: 'ID invalide.' });

    try {
        // Récupérer le devis
        const quoteResult = await pool.query(
            'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
            [quoteId, req.user.id]
        );
        if (quoteResult.rows.length === 0) return res.status(404).json({ error: 'Devis non trouvé.' });
        const quote = quoteResult.rows[0];

        // Récupérer les paramètres entreprise
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        const settings = settingsResult.rows[0] || {};

        // Email du client
        const clientEmail = quote.client_email || (req.body.email || '');
        if (!clientEmail) {
            return res.status(400).json({ error: 'Aucun email client. Ajoutez-en un ou sélectionnez un client avec email.' });
        }

        // Générer ou réutiliser le token
        let token = quote.public_token;
        if (!token) {
            token = crypto.randomBytes(32).toString('hex');
        }

        // Mettre à jour le devis
        await pool.query(`
            UPDATE quotes
            SET public_token = $1,
                sent_to_client_at = NOW(),
                status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        `, [token, quoteId, req.user.id]);

        // URL publique
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const publicUrl = `${baseUrl}/sign.html?token=${token}`;

        // Envoyer l'email
        if (process.env.RESEND_API_KEY) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const clientName = quote.client_name || 'Bonjour';
                const companyName = settings.company_name || 'Notre entreprise';
                const total = parseFloat(quote.total).toFixed(2);

                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
                    to: [clientEmail],
                    subject: `Votre devis ${quote.quote_number} — ${companyName}`,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
                            <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Votre devis ${quote.quote_number}</h1>
                            <p style="font-size:15px;line-height:1.6;color:#334155;">
                                Bonjour ${clientName},
                            </p>
                            <p style="font-size:15px;line-height:1.6;color:#334155;">
                                Veuillez trouver ci-dessous votre devis émis par <strong>${companyName}</strong> pour un montant de <strong>${total} €</strong>.
                            </p>
                            <p style="font-size:15px;line-height:1.6;color:#334155;">
                                Cliquez sur le bouton ci-dessous pour consulter le devis en détail et l'accepter en ligne :
                            </p>
                            <p style="text-align:center;margin:32px 0;">
                                <a href="${publicUrl}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Voir et signer le devis</a>
                            </p>
                            <p style="font-size:13px;color:#64748b;line-height:1.6;">
                                Date d'émission : ${new Date(quote.issue_date).toLocaleDateString('fr-FR')}<br>
                                Valable jusqu'au : ${new Date(quote.valid_date).toLocaleDateString('fr-FR')}
                            </p>
                            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                            <p style="font-size:12px;color:#94a3b8;">
                                Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>
                                <span style="word-break:break-all;color:#f97316;">${publicUrl}</span>
                            </p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error('Erreur envoi email devis:', emailErr);
                // On ne bloque pas : le token est créé, on peut renvoyer le lien manuellement
            }
        } else {
            console.warn('RESEND_API_KEY absente — email non envoyé. Lien:', publicUrl);
        }

        res.json({ success: true, publicUrl, token });
    } catch (err) {
        console.error('Erreur send-to-client:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// ROUTES PUBLIQUES (pas d'authentification)
// ============================================================

// GET /api/public/quotes/:token — Récupérer un devis par son token
app.get('/api/public/quotes/:token', async (req, res) => {
    try {
        const { token } = req.params;
        if (!token || token.length < 32) return res.status(400).json({ error: 'Token invalide.' });

        const result = await pool.query(`
            SELECT q.*, u.id as owner_id
            FROM quotes q
            JOIN users u ON u.id = q.user_id
            WHERE q.public_token = $1
        `, [token]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
        const q = result.rows[0];

        // Charger les paramètres du propriétaire pour afficher le header du devis
        const settingsResult = await pool.query('SELECT * FROM settings WHERE user_id = $1', [q.owner_id]);
        const s = settingsResult.rows[0] || {};

        // Marquer comme vu (seulement la première fois)
        if (!q.client_viewed_at) {
            await pool.query('UPDATE quotes SET client_viewed_at = NOW() WHERE id = $1', [q.id]);
        }

        res.json({
            quote: {
                quoteNumber: q.quote_number,
                issueDate: q.issue_date,
                validDate: q.valid_date,
                status: q.status,
                subtotal: parseFloat(q.subtotal) || 0,
                vatAmount: parseFloat(q.vat_amount) || 0,
                total: parseFloat(q.total),
                vatRegime: q.vat_regime,
                items: q.items,
                clientName: q.client_name,
                clientAddress: q.client_address,
                clientVat: q.client_vat,
                clientEmail: q.client_email,
                signature: q.signature_signed_at ? {
                    method: q.signature_method,
                    data: q.signature_data,
                    signedAt: q.signature_signed_at,
                    signedBy: q.signature_signed_by
                } : null
            },
            company: {
                companyName: s.company_name,
                address: s.address,
                siret: s.siret,
                tva: s.tva,
                phone: s.phone,
                email: s.email,
                website: s.website,
                logo: s.logo,
                vatRegime: s.vat_regime,
                vatRate: parseFloat(s.vat_rate) || 21,
                signatureMethod: s.signature_method || 'checkbox'
            }
        });
    } catch (err) {
        console.error('Erreur public quote:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// POST /api/public/quotes/:token/sign — Signature par le client (sans auth)
app.post('/api/public/quotes/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { method, signedBy, signatureData, accepted } = req.body;

        if (!['checkbox', 'draw'].includes(method)) {
            return res.status(400).json({ error: 'Méthode invalide.' });
        }
        if (!signedBy || !signedBy.trim()) {
            return res.status(400).json({ error: 'Nom du signataire requis.' });
        }
        if (method === 'checkbox' && !accepted) {
            return res.status(400).json({ error: 'Vous devez accepter les conditions.' });
        }
        if (method === 'draw' && (!signatureData || signatureData.length < 100)) {
            return res.status(400).json({ error: 'Signature vide.' });
        }

        // Vérifier que le devis existe et n'est pas déjà signé
        const checkResult = await pool.query(
            'SELECT id, signature_signed_at FROM quotes WHERE public_token = $1',
            [token]
        );
        if (checkResult.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
        if (checkResult.rows[0].signature_signed_at) {
            return res.status(400).json({ error: 'Ce devis a déjà été signé.' });
        }

        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

        await pool.query(`
            UPDATE quotes
            SET signature_method = $1,
                signature_data = $2,
                signature_signed_at = NOW(),
                signature_signed_by = $3,
                signature_ip = $4,
                status = 'accepted',
                updated_at = NOW()
            WHERE public_token = $5
        `, [
            method,
            method === 'draw' ? signatureData : null,
            signedBy.trim(),
            ip,
            token
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur public sign:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// GET /api/public/quotes/:token/pdf — Télécharger le PDF du devis (sans auth)
app.get('/api/public/quotes/:token/pdf', async (req, res) => {
    try {
        const { token } = req.params;
        const result = await pool.query(`
            SELECT q.*, u.id as owner_id
            FROM quotes q
            JOIN users u ON u.id = q.user_id
            WHERE q.public_token = $1
        `, [token]);

        if (result.rows.length === 0) return res.status(404).send('Devis introuvable.');
        const q = result.rows[0];

        const settingsResult = await pool.query('SELECT * FROM settings WHERE user_id = $1', [q.owner_id]);
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

        const client = {
            name: q.client_name,
            address: q.client_address,
            vat: q.client_vat,
            email: q.client_email
        };

        const signature = q.signature_signed_at ? {
            method: q.signature_method,
            data: q.signature_data,
            signedAt: q.signature_signed_at,
            signedBy: q.signature_signed_by,
            ip: q.signature_ip
        } : null;

        const pdfBytes = await generateQuotePDF(
            q.items,
            parseFloat(q.subtotal) || 0,
            parseFloat(q.vat_amount) || 0,
            parseFloat(q.total),
            q.vat_regime,
            parseFloat(s.vat_rate) || 21,
            q.quote_number,
            q.issue_date,
            q.valid_date,
            company,
            client,
            signature
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=devis_${q.quote_number}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Erreur public pdf:', err);
        res.status(500).send('Erreur PDF.');
    }
});

// ============================================================
// DELETE /api/account — Suppression définitive du compte (RGPD Art. 17)
// ============================================================
app.delete('/api/account', authenticateToken, async (req, res) => {
    const { password, confirm } = req.body;

    if (confirm !== 'DELETE_MY_ACCOUNT') {
        return res.status(400).json({ error: 'Confirmation manquante.' });
    }
    if (!password) {
        return res.status(400).json({ error: 'Mot de passe requis pour confirmer.' });
    }

    try {
        // 1. Vérifier le mot de passe
        const userResult = await pool.query(
            'SELECT id, password_hash, email FROM users WHERE id = $1',
            [req.user.id]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }
        const user = userResult.rows[0];

        const bcrypt = require('bcrypt');
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Mot de passe incorrect.' });
        }

        // 2. Annuler l'abonnement Stripe si actif
        if (user.stripe_customer_id) {
            try {
                const Stripe = require('stripe');
                const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

                // Récupérer les abonnements actifs
                const subscriptions = await stripe.subscriptions.list({
                    customer: user.stripe_customer_id,
                    status: 'active',
                    limit: 5
                });

                // Annuler chaque abonnement actif
                for (const sub of subscriptions.data) {
                    await stripe.subscriptions.cancel(sub.id);
                    console.log(`🔴 Abonnement Stripe annulé : ${sub.id}`);
                }
            } catch (stripeErr) {
                console.error('⚠️ Erreur annulation Stripe (on continue):', stripeErr.message);
                // On continue la suppression même si Stripe échoue
            }
        }

        // 3. Supprimer l'utilisateur (CASCADE supprime tout : settings, clients, products, quotes, etc.)
        await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);

        console.log(`🗑 Compte supprimé (RGPD) : ${user.email}`);
        res.json({ success: true, message: 'Compte et données supprimés définitivement.' });
    } catch (err) {
        console.error('Erreur suppression compte:', err);
        res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
});

// ============================================================
// GET /api/export-data — Export RGPD (toutes les données de l'utilisateur)
// ============================================================
app.get('/api/export-data', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Récupérer toutes les données
        const [userResult, settingsResult, clientsResult, productsResult, quotesResult] = await Promise.all([
            pool.query('SELECT email, created_at FROM users WHERE id = $1', [userId]),
            pool.query('SELECT * FROM settings WHERE user_id = $1', [userId]),
            pool.query('SELECT * FROM clients WHERE user_id = $1 ORDER BY name', [userId]),
            pool.query('SELECT * FROM products WHERE user_id = $1 ORDER BY name', [userId]),
            pool.query('SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC', [userId])
        ]);

        const exportData = {
            export_info: {
                generated_at: new Date().toISOString(),
                user_email: userResult.rows[0]?.email || null,
                rgpd_article: 'Article 20 - Droit à la portabilité des données',
                format_version: '1.0'
            },
            account: {
                email: userResult.rows[0]?.email,
                created_at: userResult.rows[0]?.created_at
            },
            company_settings: settingsResult.rows[0] || null,
            clients: clientsResult.rows.map(c => ({
                name: c.name,
                contact_name: c.contact_name,
                email: c.email,
                phone: c.phone,
                address: c.address,
                vat_number: c.vat_number,
                notes: c.notes,
                created_at: c.created_at
            })),
            products: productsResult.rows.map(p => ({
                ref: p.ref,
                name: p.name,
                description: p.description,
                unit: p.unit,
                unit_price: parseFloat(p.unit_price),
                category: p.category,
                created_at: p.created_at
            })),
            quotes: quotesResult.rows.map(q => ({
                quote_number: q.quote_number,
                issue_date: q.issue_date,
                valid_date: q.valid_date,
                status: q.status,
                subtotal: parseFloat(q.subtotal) || 0,
                vat_amount: parseFloat(q.vat_amount) || 0,
                total: parseFloat(q.total),
                vat_regime: q.vat_regime,
                items: q.items,
                client_name: q.client_name,
                client_address: q.client_address,
                client_vat: q.client_vat,
                client_email: q.client_email,
                created_at: q.created_at
            }))
        };

        // Envoyer en JSON téléchargeable
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=export-rgpd-${new Date().toISOString().slice(0,10)}.json`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (err) {
        console.error('Erreur export RGPD:', err);
        res.status(500).json({ error: 'Erreur lors de l\'export.' });
    }
});

// ============================================================
// GET /api/dashboard/charts — Données pour les graphiques
// ============================================================
app.get('/api/dashboard/charts', authenticateToken, async (req, res) => {
    try {
        // 1. Chiffre d'affaires par mois (12 derniers mois)
        const monthlyResult = await pool.query(`
            SELECT 
                TO_CHAR(issue_date, 'YYYY-MM') as month,
                SUM(total) as revenue,
                COUNT(*) as count
            FROM quotes
            WHERE user_id = $1
              AND issue_date >= NOW() - INTERVAL '12 months'
            GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
            ORDER BY month ASC
        `, [req.user.id]);

        // Générer les 12 derniers mois (même si vides)
        const months = [];
        const revenueByMonth = {};
        const countByMonth = {};
        monthlyResult.rows.forEach(r => {
            revenueByMonth[r.month] = parseFloat(r.revenue) || 0;
            countByMonth[r.month] = parseInt(r.count) || 0;
        });

        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months.push({
                month: key,
                label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
                revenue: revenueByMonth[key] || 0,
                count: countByMonth[key] || 0
            });
        }

        // 2. Répartition par statut
        const statusResult = await pool.query(`
            SELECT 
                COALESCE(status, 'draft') as status,
                COUNT(*) as count
            FROM quotes
            WHERE user_id = $1
            GROUP BY COALESCE(status, 'draft')
        `, [req.user.id]);

        const statuses = { draft: 0, sent: 0, accepted: 0, refused: 0 };
        statusResult.rows.forEach(r => {
            statuses[r.status] = parseInt(r.count) || 0;
        });

        res.json({ months, statuses });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT total, items FROM quotes WHERE user_id = $1',
            [req.user.id]
        );
        const rows = result.rows;
        const totalQuotes = rows.length;
        const totalAmount = rows.reduce((sum, r) => sum + parseFloat(r.total), 0);

        const productCounts = {};
        rows.forEach(row => {
            const items = row.items || [];
            items.forEach(item => {
                const name = item.name || 'Inconnu';
                productCounts[name] = (productCounts[name] || 0) + (item.qty || 1);
            });
        });
        const topProducts = Object.entries(productCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, qty]) => ({ name, qty }));

        res.json({ totalQuotes, totalAmount, topProducts });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// Route par défaut
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============================================================
// Démarrage
// ============================================================
initDB()
    .then(() => {
        app.listen(port, () => {
            console.log(`Serveur Pro lancé sur http://localhost:${port}`);
        });
    })
    .catch(err => {
        console.error('Erreur init DB:', err);
        process.exit(1);
    });