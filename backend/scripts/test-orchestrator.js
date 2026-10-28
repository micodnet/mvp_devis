// backend/scripts/test-orchestrator.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const orchestrator = require('../utils/assistant/core/orchestrator');

// ⚠️ Change ce userId par un vrai userId de ta base
const TEST_USER_ID = 1;

// Récupère un vrai userId depuis la base
const { pool } = require('../db');

(async () => {
    // Récupérer un vrai userId (le premier de la table users)
    let TEST_USER_ID;
    try {
        const r = await pool.query('SELECT id FROM users LIMIT 1');
        if (r.rows.length === 0) {
            console.error('❌ Aucun utilisateur en base. Crée-en un d\'abord.');
            process.exit(1);
        }
        TEST_USER_ID = r.rows[0].id;
        console.log(`✅ Test avec userId = ${TEST_USER_ID}\n`);
    } catch (err) {
        console.error('❌ Impossible de récupérer un userId :', err.message);
        process.exit(1);
    }

    await testMessage('Bonjour');
    // ... etc
})();

async function testMessage(msg) {
    console.log('\n' + '═'.repeat(60));
    console.log(`👤 Utilisateur : "${msg}"`);
    console.log('═'.repeat(60));

    try {
        const result = await orchestrator.chat(msg, TEST_USER_ID, []);
        console.log(`\n🤖 Clara : ${typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2)}`);
        console.log(`\n📊 Meta : intent=${result.intent}, durationMs=${result.durationMs}, hasData=${result.hasData}`);
        if (result.isPendingAction) {
            console.log(`⚠️  PendingAction : ${result.pendingKind || 'confirm_action'}`);
        }
    } catch (err) {
        console.error(`❌ Erreur : ${err.message}`);
        console.error(err.stack);
    }
}

(async () => {
    // Test 1 : conversation
    await testMessage('Bonjour');

    // Test 2 : lecture
    await testMessage('Montre-moi mes devis');

    // Test 3 : calcul
    await testMessage('Peindre 3 murs de 3m sur 2.5m');

    // Test 4 : écriture (devrait créer un brouillon)
    await testMessage('Crée un client nommé Vincent Dubois');
})();