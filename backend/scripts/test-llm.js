// backend/scripts/test-llm.js
require('dotenv').config();
const llm = require('../utils/assistant_v2/llm/client');

(async () => {
    console.log('🔍 Health check...');
    const health = await llm.healthCheck();
    console.log(JSON.stringify(health, null, 2));

    console.log('\n💬 Test chat Groq...');
    try {
        const response = await llm.chat({
            system: 'Tu es un assistant concis.',
            user: 'Dis bonjour en une phrase.',
            tier: 'light',
        });
        console.log('Réponse :', response);
    } catch (err) {
        console.error('❌ Chat échoué :', err.message);
    }

    console.log('\n🧮 Test embedding Ollama...');
    try {
        const vec = await llm.embed('Bonjour le monde');
        console.log(`Embedding : ${vec.length} dimensions`);
        console.log(`3 premières valeurs : ${vec.slice(0, 3)}`);
    } catch (err) {
        console.error('❌ Embedding échoué :', err.message);
        console.error('   → Vérifie qu\'Ollama tourne : ollama serve');
        console.error('   → Vérifie le modèle : ollama pull nomic-embed-text');
    }
})();