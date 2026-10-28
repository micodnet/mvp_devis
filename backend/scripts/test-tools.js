// backend/scripts/test-tools.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { TOOLS, buildToolsCatalog, getToolNames } = require('../utils/assistant/tools/registry');

console.log('📦 Outils disponibles :');
console.log(getToolNames().map(n => `  - ${n}`).join('\n'));
console.log(`\n📊 Total : ${getToolNames().length} outils\n`);

console.log('📝 Catalogue pour le Planner :');
console.log(buildToolsCatalog().slice(0, 1000) + '\n...');

console.log('\n🔍 Détail de quelques outils :');
for (const name of ['calculate_quote', 'create_quote', 'delete_quote', 'list_quotes']) {
    const t = TOOLS[name];
    console.log(`\n${name} :`);
    console.log(`  description: ${t.description}`);
    console.log(`  category: ${t.category}`);
    console.log(`  critical: ${t.critical}`);
    console.log(`  schema: ${JSON.stringify(t.schema)}`);
}

// node scripts/test-tools.js