// const { Pool } = require('pg');

// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     ssl: { rejectUnauthorized: false } // requis pour Supabase
// });

// // Initialisation du schéma (créé une seule fois, idempotent)
// async function initDB() {
//     await pool.query(`
//         CREATE TABLE IF NOT EXISTS users (
//             id SERIAL PRIMARY KEY,
//             email VARCHAR(255) UNIQUE NOT NULL,
//             password_hash VARCHAR(255) NOT NULL,
//             created_at TIMESTAMP DEFAULT NOW()
//         );

//         CREATE TABLE IF NOT EXISTS settings (
//             user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
//             company_name VARCHAR(255) DEFAULT 'Votre Entreprise',
//             address TEXT DEFAULT '',
//             siret VARCHAR(50) DEFAULT '',
//             tva VARCHAR(50) DEFAULT '',
//             phone VARCHAR(50) DEFAULT '',
//             email VARCHAR(255) DEFAULT '',
//             website VARCHAR(255) DEFAULT '',
//             logo TEXT,
//             updated_at TIMESTAMP DEFAULT NOW()
//         );

//         CREATE TABLE IF NOT EXISTS quotes (
//             id SERIAL PRIMARY KEY,
//             user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
//             quote_number VARCHAR(50) NOT NULL,
//             issue_date DATE NOT NULL,
//             valid_date DATE NOT NULL,
//             total NUMERIC(10,2) NOT NULL,
//             items JSONB NOT NULL,
//             client_email VARCHAR(255),
//             created_at TIMESTAMP DEFAULT NOW()
//         );

//         CREATE TABLE IF NOT EXISTS counters (
//             user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
//             last_number INTEGER DEFAULT 0
//         );

//         CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
//     `);
//     console.log('✅ Base de données initialisée.');
// }

// module.exports = { pool, initDB };

// backend/db.js
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ⚠️ IMPORTANT : ton schéma Supabase est déjà complet (tu l'as créé manuellement).
// initDB() ne doit PAS recréer les tables, car il pourrait masquer des divergences
// ou créer des tables avec des colonnes incomplètes.
// Cette fonction vérifie simplement que la connexion fonctionne.
async function initDB() {
    try {
        const result = await pool.query('SELECT NOW() as now');
        console.log(`✅ Base de données connectée (${result.rows[0].now})`);
    } catch (err) {
        console.error('❌ Impossible de se connecter à la base:', err.message);
        throw err;
    }
}

module.exports = { pool, initDB };