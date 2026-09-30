// backend/utils/cron/proactive-cron.js
// Cron qui relance la detection proactive toutes les heures

const { runDetectionForAllUsers } = require('../proactive/detector');

async function processAllUsers() {
    console.log('Detection proactive : demarrage...');

    try {
        const result = await runDetectionForAllUsers();

        console.log('Detection proactive : ' +
            result.users + ' utilisateur(s) traites, ' +
            result.detected + ' suggestion(s) creee(s)/mise(s) a jour, ' +
            result.errors + ' erreur(s)');

        return result;
    } catch (err) {
        console.error('Erreur detection proactive globale:', err);
        return { error: err.message };
    }
}

function startProactiveCron() {
    // Lancer 60 secondes apres le demarrage
    setTimeout(() => {
        processAllUsers().catch(console.error);
    }, 60000);

    // Puis toutes les heures
    setInterval(() => {
        processAllUsers().catch(console.error);
    }, 60 * 60 * 1000);

    console.log('Cron proactif demarre (toutes les heures)');
}

module.exports = {
    processAllUsers,
    startProactiveCron
};