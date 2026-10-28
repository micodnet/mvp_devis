// backend/scripts/test-v2-e2e.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../db');
const orchestrator = require('../utils/assistant/core/orchestrator');
const trainingCollector = require('../utils/assistant/llm/training-collector');

// async function getTestUserId() {
//     try {
//         const r = await pool.query('SELECT id FROM auth.users LIMIT 1');
//         if (r.rows.length > 0) {
//             console.log('✅ userId (auth.users UUID) =', r.rows[0].id);
//             return r.rows[0].id;
//         }
//     } catch (e) {
//         // auth.users n'est pas accessible via SQL direct
//     }

//     // Fallback : ta table users
//     const r = await pool.query('SELECT id FROM users LIMIT 1');
//     if (r.rows.length === 0) throw new Error('Aucun utilisateur en base');
//     console.log('⚠️  userId (table users) =', r.rows[0].id, '(type:', typeof r.rows[0].id, ')');
//     return r.rows[0].id;
//     // const r = await pool.query('SELECT id FROM users LIMIT 1');
//     // if (r.rows.length === 0) throw new Error('Aucun utilisateur en base');
//     // return r.rows[0].id;
// }
// backend/scripts/test-v2-e2e.js
// async function getTestUserId() {
//     // Essaie auth.users en premier (le plus fiable)
//     try {
//         const r = await pool.query('SELECT id FROM auth.users LIMIT 1');
//         if (r.rows.length > 0) {
//             console.log('✅ userId (auth.users) =', r.rows[0].id);
//             return r.rows[0].id;
//         }
//     } catch (e) {
//         console.log('⚠️  auth.users non accessible directement:', e.message);
//     }

//     // Fallback : ta table users.user_id
//     const r = await pool.query('SELECT user_id FROM users LIMIT 1');
//     if (r.rows.length === 0) throw new Error('Aucun utilisateur en base');
//     console.log('✅ userId (users.user_id) =', r.rows[0].user_id);
//     return r.rows[0].user_id;
// }
async function getTestUserId() {
    const r = await pool.query('SELECT id FROM users LIMIT 1');
    if (r.rows.length === 0) throw new Error('Aucun utilisateur en base');
    console.log('✅ userId (users.id) =', r.rows[0].id, '(type: integer)');
    return r.rows[0].id;
}

(async () => {
    const userId = await getTestUserId();
    console.log(`✅ Test E2E avec userId = ${userId}\n`);

    // ═══════════════════════════════════════════════════════════
    // Test 1 : création de devis avec confirmation
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(60));
    console.log('TEST : Calcul devis peinture + confirmation');
    console.log('═'.repeat(60));

    const chatResult = await orchestrator.chat('Peindre 3 murs de 3m sur 2.5m', userId, []);
    console.log(`\n🤖 Clara : ${chatResult.response.slice(0, 200)}...`);

    if (chatResult.isPendingAction && chatResult.draft) {
        console.log(`\n⚠️  Brouillon détecté : ${chatResult.draft.type}`);
        console.log('   Simulation de confirmation...\n');

        try {
            const confirmResult = await orchestrator.confirmAction(chatResult.draft, userId);
            console.log(`✅ Confirmation OK :`, JSON.stringify(confirmResult, null, 2).slice(0, 300));

            // Collecter pour fine-tuning
            await trainingCollector.collectConfirmation({
                userId,
                draft: chatResult.draft,
                result: confirmResult,
            });
        } catch (err) {
            console.error(`❌ Confirmation échouée : ${err.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Test 2 : export pour fine-tuning
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('TEST : Export pour fine-tuning');
    console.log('═'.repeat(60));

    const examples = await trainingCollector.exportForFineTuning(userId, { minQuality: 0.5, limit: 10 });
    console.log(`📚 ${examples.length} exemple(s) prêt(s) pour fine-tuning`);
    if (examples.length > 0) {
        console.log('Exemple :', JSON.stringify(examples[0], null, 2).slice(0, 500));
    }

    console.log('\n✅ Test E2E terminé.');
    process.exit(0);
})().catch(err => {
    console.error('❌ Erreur fatale :', err);
    process.exit(1);
});