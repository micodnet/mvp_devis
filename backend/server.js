require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');

const { extractTextFromFile } = require('./utils/parser');
const { extractItemsFromText } = require('./utils/extractor');
const { generateQuotePDF } = require('./utils/pdf-generator');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================================
// 1. GESTION DES FICHIERS DE STOCKAGE (settings, history, counter)
// ============================================================

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// Initialisation des fichiers s'ils n'existent pas
if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
        companyName: 'Votre Entreprise',
        address: '1 rue de la Paix, 75000 Paris',
        siret: '123 456 789 00010',
        tva: 'FR 12 3456789',
        phone: '01 23 45 67 89',
        email: 'contact@votreentreprise.com',
        website: 'www.votreentreprise.com',
        logo: null // base64 ou chemin
    }, null, 2));
}
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(COUNTER_FILE)) {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ lastNumber: 0 }, null, 2));
}

// ============================================================
// 2. ROUTES PARAMÈTRES
// ============================================================

app.get('/api/settings', (req, res) => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    const newSettings = req.body;
    // Valider les champs obligatoires
    if (!newSettings.companyName) {
        return res.status(400).json({ error: 'Le nom de l\'entreprise est requis.' });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
    res.json({ success: true });
});

// ============================================================
// 3. ROUTES HISTORIQUE
// ============================================================

app.get('/api/history', (req, res) => {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    res.json(history);
});

app.post('/api/history', (req, res) => {
    const entry = req.body;
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    history.push(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ success: true });
});

// ============================================================
// 4. ROUTES DEVIS (génération)
// ============================================================

// Configuration Multer (inchangée)
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

// Route principale : générer le devis
app.post('/api/generate-quote', upload.single('file'), async (req, res) => {
    const logs = [];
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Aucun fichier envoyé' });
        }
        const filePath = req.file.path;
        const mimeType = req.file.mimetype;

        logs.push(`Fichier reçu : ${req.file.originalname}`);

        // Extraire le texte
        const text = await extractTextFromFile(filePath, mimeType);
        if (!text || text.trim().length < 10) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Fichier vide ou illisible.' });
        }
        logs.push(`Texte extrait (${text.length} caractères).`);

        // Extraire les articles avec l'IA
        const result = await extractItemsFromText(text);
        const items = result.items;
        const iaLogs = result.logs || [];

        // Calculer le total
        const total = items.reduce((sum, item) => sum + item.total, 0);
        logs.push(`Total calculé : ${total.toFixed(2)} €`);

        // Nettoyer le fichier uploadé
        fs.unlinkSync(filePath);

        // --- Génération du numéro de devis unique ---
        const counter = JSON.parse(fs.readFileSync(COUNTER_FILE));
        const newNumber = counter.lastNumber + 1;
        counter.lastNumber = newNumber;
        fs.writeFileSync(COUNTER_FILE, JSON.stringify(counter, null, 2));
        const quoteNumber = `DEVIS-${String(newNumber).padStart(4, '0')}-${new Date().getFullYear()}`;

        // Date d'émission et de validité
        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const validDate = validUntil.toISOString().slice(0, 10);

        // Charger les paramètres entreprise
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));

        // Réponse avec toutes les infos
        res.json({
            items,
            total,
            logs: [...logs, ...iaLogs],
            quoteNumber,
            issueDate,
            validDate,
            company: settings
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Erreur interne' });
    }
});

// ============================================================
// 5. ROUTE TÉLÉCHARGEMENT PDF
// ============================================================

app.get('/api/download-pdf', async (req, res) => {
    try {
        const dataParam = req.query.data;
        if (!dataParam) {
            return res.status(400).send('Données manquantes');
        }
        const data = JSON.parse(decodeURIComponent(dataParam));
        const { items, total, quoteNumber, issueDate, validDate, company } = data;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).send('Aucun article à générer');
        }

        const pdfBytes = await generateQuotePDF(items, total, quoteNumber, issueDate, validDate, company);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=devis_' + quoteNumber + '.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur génération PDF');
    }
});

// ============================================================
// 6. ROUTE ENVOI PAR EMAIL (avec Resend)
// ============================================================

app.post('/api/send-email', async (req, res) => {
    try {
        const { email, items, total, quoteNumber, issueDate, validDate, company } = req.body;

        if (!email || !items || items.length === 0) {
            return res.status(400).json({ error: 'Email et articles requis.' });
        }

        // Générer le PDF en mémoire (sans le sauvegarder)
        const pdfBytes = await generateQuotePDF(items, total, quoteNumber, issueDate, validDate, company);

        // Initialiser Resend avec la clé API
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Construire le contenu HTML de l'email
        const htmlContent = `
            <h1>Devis ${quoteNumber}</h1>
            <p>Bonjour,</p>
            <p>Veuillez trouver ci-joint votre devis pour un montant total de <strong>${total.toFixed(2)} €</strong>.</p>
            <p>Date d'émission : ${issueDate}</p>
            <p>Date de validité : ${validDate}</p>
            <p>Nous restons à votre disposition pour toute question.</p>
            <br>
            <p>${company.companyName}</p>
            <p>${company.address}</p>
            <p>Tél : ${company.phone}</p>
        `;

        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Devis <noreply@votreentreprise.com>',
            to: [email],
            subject: `Votre devis ${quoteNumber}`,
            html: htmlContent,
            attachments: [
                {
                    filename: `devis_${quoteNumber}.pdf`,
                    content: Buffer.from(pdfBytes).toString('base64'),
                    contentType: 'application/pdf'
                }
            ]
        });

        if (error) {
            console.error('Erreur Resend :', error);
            return res.status(500).json({ error: error.message });
        }

        // Ajouter l'envoi à l'historique (optionnel)
        // On pourrait l'ajouter ici avec un statut "envoyé"

        res.json({ success: true, message: 'Email envoyé avec succès.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Erreur lors de l\'envoi' });
    }
});

// ============================================================
// 7. ROUTE DASHBOARD (statistiques)
// ============================================================

app.get('/api/dashboard', (req, res) => {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    const totalQuotes = history.length;
    const totalAmount = history.reduce((sum, entry) => sum + (entry.total || 0), 0);
    // Produits les plus demandés : on compte les occurrences de chaque produit
    const productCounts = {};
    history.forEach(entry => {
        if (entry.items && Array.isArray(entry.items)) {
            entry.items.forEach(item => {
                const name = item.name || 'Inconnu';
                productCounts[name] = (productCounts[name] || 0) + (item.qty || 1);
            });
        }
    });
    const topProducts = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));

    res.json({ totalQuotes, totalAmount, topProducts });
});

// ============================================================
// 8. ROUTE PAR DÉFAUT
// ============================================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============================================================
// 9. LANCEMENT
// ============================================================

app.listen(port, () => {
    console.log(`Serveur Pro lancé sur http://localhost:${port}`);
});