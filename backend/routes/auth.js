// backend/routes/auth.js
// ------------------------------------------------------------
// Routes d'authentification : inscription et connexion
// ------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

// ------------------------------------------------------------
// POST /api/auth/signup
// Crée un nouvel utilisateur
// ------------------------------------------------------------
router.post('/signup', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    try {
        // Vérifier si l'utilisateur existe déjà
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        // Hasher le mot de passe
        const passwordHash = await bcrypt.hash(password, 10);

        // Insérer l'utilisateur
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
            [email, passwordHash]
        );
        const user = result.rows[0];

        // Créer une ligne "settings" par défaut + un compteur pour cet utilisateur
        await pool.query(
            'INSERT INTO settings (user_id) VALUES ($1)',
            [user.id]
        );
        await pool.query(
            'INSERT INTO counters (user_id, last_number) VALUES ($1, 0)',
            [user.id]
        );

        // Générer le JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('Erreur signup:', err);
        res.status(500).json({ error: 'Erreur lors de l\'inscription.' });
    }
});

// ------------------------------------------------------------
// POST /api/auth/login
// Connexion d'un utilisateur existant
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    try {
        const result = await pool.query(
            'SELECT id, email, password_hash FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        // Générer le JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('Erreur login:', err);
        res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
});

module.exports = router;