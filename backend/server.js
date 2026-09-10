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
app.use(express.json({ limit: '10mb' })); // 10mb pour le logo en base64
app.use(express.static(path.join(__dirname, '../frontend')));

// ------------------------------------------------------------
// ROUTES PUBLIQUES (pas d'authentification requise)
// ------------------------------------------------------------
app.use('/api/auth', authRoutes);

// ------------------------------------------------------------
// MULTER (upload de fichiers)
// ------------------------------------------------------------
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
// ROUTES PROTÉGÉES (authentification requise)
// ============================================================

// ------------------------------------------------------------
// GET /api/settings — Récupérer les paramètres de l'utilisateur
// ------------------------------------------------------------
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            // Cas rare : créer par défaut si absent
            await pool.query('INSERT INTO settings (user_id) VALUES ($1)', [req.user.id]);
            return res.json({ companyName: 'Votre Entreprise' });
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
            logo: s.logo
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ------------------------------------------------------------
// POST /api/settings — Sauvegarder les paramètres
// ------------------------------------------------------------
app.post('/api/settings', authenticateToken, async (req, res) => {
    const { companyName, address, siret, tva, phone, email, website, logo } = req.body;
    try {
        await pool.query(`
            INSERT INTO settings (user_id, company_name, address, siret, tva, phone, email, website, logo, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                address = EXCLUDED.address,
                siret = EXCLUDED.siret,
                tva = EXCLUDED.tva,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                website = EXCLUDED.website,
                logo = COALESCE(EXCLUDED.logo, settings.logo),
                updated_at = NOW()
        `, [req.user.id, companyName, address, siret, tva, phone, email, website, logo]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde.' });
    }
});

// ------------------------------------------------------------
// GET /api/history — Historique des devis de l'utilisateur
// ------------------------------------------------------------
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
            total: parseFloat(r.total),
            items: r.items,
            clientEmail: r.client_email
        }));
        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ------------------------------------------------------------
// POST /api/generate-quote — Générer un devis (IA)
// ------------------------------------------------------------
app.post('/api/generate-quote', authenticateToken, upload.single('file'), async (req, res) => {
    const logs = [];
    try {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
        const filePath = req.file.path;
        const mimeType = req.file.mimetype;

        logs.push(`📂 Fichier reçu : ${req.file.originalname}`);
        const text = await extractTextFromFile(filePath, mimeType);
        if (!text || text.trim().length < 10) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Fichier vide ou illisible.' });
        }
        logs.push(`📝 Texte extrait (${text.length} caractères).`);

        const result = await extractItemsFromText(text);
        const items = result.items;
        const iaLogs = result.logs || [];
        const total = items.reduce((sum, item) => sum + item.total, 0);
        logs.push(`💰 Total calculé : ${total.toFixed(2)} €`);
        fs.unlinkSync(filePath);

        // --- Générer un numéro de devis UNIQUE PAR UTILISATEUR ---
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

        // --- Charger les paramètres de CET utilisateur ---
        const settingsResult = await pool.query(
            'SELECT * FROM settings WHERE user_id = $1',
            [req.user.id]
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
            logo: s.logo
        };

        // --- Sauvegarder le devis dans la base (sans le client email pour l'instant) ---
        await pool.query(`
            INSERT INTO quotes (user_id, quote_number, issue_date, valid_date, total, items)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.user.id, quoteNumber, issueDate, validDate, total, JSON.stringify(items)]);

        res.json({
            items,
            total,
            logs: [...logs, ...iaLogs],
            quoteNumber,
            issueDate,
            validDate,
            company
        });
    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: error.message || 'Erreur interne' });
    }
});

// ------------------------------------------------------------
// GET /api/download-pdf — Générer le PDF
// ------------------------------------------------------------
app.get('/api/download-pdf', authenticateToken, async (req, res) => {
    try {
        const dataParam = req.query.data;
        if (!dataParam) return res.status(400).send('Données manquantes');
        const data = JSON.parse(decodeURIComponent(dataParam));
        const { items, total, quoteNumber, issueDate, validDate, company } = data;

        if (!items || items.length === 0) return res.status(400).send('Aucun article');

        const pdfBytes = await generateQuotePDF(items, total, quoteNumber, issueDate, validDate, company);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=devis_${quoteNumber}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur génération PDF');
    }
});

// ------------------------------------------------------------
// POST /api/send-email — Envoyer le devis par email
// ------------------------------------------------------------
app.post('/api/send-email', authenticateToken, async (req, res) => {
    try {
        const { email, items, total, quoteNumber, issueDate, validDate, company } = req.body;
        if (!email || !items || items.length === 0) {
            return res.status(400).json({ error: 'Email et articles requis.' });
        }
        const pdfBytes = await generateQuotePDF(items, total, quoteNumber, issueDate, validDate, company);
        const resend = new Resend(process.env.RESEND_API_KEY);

        const htmlContent = `
            <h1>Devis ${quoteNumber}</h1>
            <p>Bonjour,</p>
            <p>Veuillez trouver ci-joint votre devis pour un montant total de <strong>${total.toFixed(2)} €</strong>.</p>
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

        // Mettre à jour le client_email dans la base
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

// ------------------------------------------------------------
// GET /api/dashboard — Statistiques de l'utilisateur
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Route par défaut
// ------------------------------------------------------------
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ------------------------------------------------------------
// Démarrage : init DB puis serveur
// ------------------------------------------------------------
initDB()
    .then(() => {
        app.listen(port, () => {
            console.log(`🚀 Serveur Pro lancé sur http://localhost:${port}`);
        });
    })
    .catch(err => {
        console.error('❌ Erreur init DB:', err);
        process.exit(1);
    });