// backend/scripts/test-agents.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const intentAgent = require('../utils/assistant/agents/intent-agent');
const extractorAgent = require('../utils/assistant/agents/extractor-agent');
const calculatorAgent = require('../utils/assistant/agents/calculator-agent');
const criticAgent = require('../utils/assistant/agents/critic-agent');
const conversationalAgent = require('../utils/assistant/agents/conversational-agent');

(async () => {
    console.log('═══════════════════════════════════════════');
    console.log('TEST 1 : Intent Agent');
    console.log('═══════════════════════════════════════════');
    for (const msg of ['Bonjour', 'Montre-moi mes devis', 'Peindre 3 murs de 3m x 2.5m', 'Supprime le dernier devis']) {
        const r = await intentAgent.classify({ message: msg });
        console.log(`"${msg}" → ${r.category} (${r.confidence})`);
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('TEST 2 : Extractor Agent');
    console.log('═══════════════════════════════════════════');
    const extraction = await extractorAgent.extract({
        text: 'Ajoute Vincent Dubois, 12 rue de la Paix, email vincent@example.com, TVA BE0123456789',
        schema: {
            name: 'string',
            address: 'string?',
            email: 'string?',
            vatNumber: 'string?',
            phone: 'string?',
        },
    });
    console.log('Extraction :', JSON.stringify(extraction, null, 2));

    console.log('\n═══════════════════════════════════════════');
    console.log('TEST 3 : Calculator Agent');
    console.log('═══════════════════════════════════════════');
    try {
        const calc = await calculatorAgent.calculate(
            { description: 'peindre 3 murs de 3m x 2.5m' },
            1, // userId
            { userPrefs: null }
        );
        if (calc.error) console.log('Erreur :', calc.error);
        else console.log(`Métier : ${calc.metier}, ${calc.items.length} lignes, ${calc.subtotal}€`);
    } catch (err) {
        console.log('Skip (pas de userId valide en base) :', err.message);
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('TEST 4 : Critic Agent');
    console.log('═══════════════════════════════════════════');
    const critic1 = await criticAgent.check({
        tool: 'send_quote_email',
        args: { email: 'pas-un-email' },
    });
    console.log('Email invalide →', JSON.stringify(critic1));

    const critic2 = await criticAgent.check({
        tool: 'create_quote',
        args: { items: [{ name: 'X', qty: 1, unitPrice: 0 }] },
    });
    console.log('Prix 0 →', JSON.stringify(critic2));

    console.log('\n═══════════════════════════════════════════');
    console.log('TEST 5 : Conversational Agent');
    console.log('═══════════════════════════════════════════');
    const conv = await conversationalAgent.respond({
        message: 'Combien de clients ai-je ?',
        intent: 'LECTURE',
        taskResults: [{ result: { count: 42, clients: [] } }],
        session: null,
    });
    console.log('Réponse :', conv);
})();