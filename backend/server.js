require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');

const { pool, initDB } = require('./db');
const { authenticateToken } = require('./middleware/auth');
const authRoutes = require('./routes/auth');

const { extractTextFromFile } = require('./utils/parser');
const { extractItemsFromText } = require('./utils/extractor');
const { generateQuotePDF } = require('./utils/pdf-generator');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes publiques
app.use('/api/auth', authRoutes);

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
            vatRate: parseFloat(s.vat_rate) || 21
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
    const { companyName, address, siret, tva, phone, email, website, logo, vatRegime, vatRate } = req.body;
    try {
        await pool.query(`
            INSERT INTO settings (user_id, company_name, address, siret, tva, phone, email, website, logo, vat_regime, vat_rate, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
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
                updated_at = NOW()
        `, [req.user.id, companyName, address, siret, tva, phone, email, website, logo, vatRegime || 'franchise', vatRate || 21]);
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
            quoteNumber: r.quote_number,
            issueDate: r.issue_date,
            validDate: r.valid_date,
            subtotal: parseFloat(r.subtotal) || 0,
            vatAmount: parseFloat(r.vat_amount) || 0,
            total: parseFloat(r.total),
            items: r.items,
            clientName: r.client_name,
            clientEmail: r.client_email
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
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
        const filePath = req.file.path;
        const mimeType = req.file.mimetype;

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

        const result = await extractItemsFromText(text);
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
            INSERT INTO quotes (user_id, quote_number, issue_date, valid_date, subtotal, vat_amount, total, vat_regime, items, client_name, client_address, client_vat, client_email)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [req.user.id, quoteNumber, issueDate, validDate, subtotal, vatAmount, total, vatRegime,
            JSON.stringify(items), clientName, clientAddress, clientVat, clientEmail]);

        res.json({
            items, subtotal, vatAmount, total,
            vatRegime, vatRate,
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
        const { items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client } = req.body;

        if (!items || items.length === 0) return res.status(400).send('Aucun article');

        const pdfBytes = await generateQuotePDF(
            items, subtotal, vatAmount, total,
            vatRegime, vatRate, quoteNumber, issueDate, validDate,
            company, client
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=devis_${quoteNumber}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur génération PDF');
    }
});
// ============================================================
// POST /api/send-email
// ============================================================
app.post('/api/send-email', authenticateToken, async (req, res) => {
    try {
        const { email, items, subtotal, vatAmount, total, vatRegime, vatRate, quoteNumber, issueDate, validDate, company, client } = req.body;
        if (!email || !items || items.length === 0) {
            return res.status(400).json({ error: 'Email et articles requis.' });
        }
        const pdfBytes = await generateQuotePDF(
            items, subtotal, vatAmount, total, vatRegime, vatRate,
            quoteNumber, issueDate, validDate, company, client
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
// ============================================================
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