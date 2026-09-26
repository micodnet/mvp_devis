// Test du SDK JavaScript
// Usage : DEVIS_API_KEY=dsk_xxx node test.js

const DevisExpress = require('./index');

const apiKey = process.env.DEVIS_API_KEY;

if (!apiKey) {
    console.error('Variable DEVIS_API_KEY requise.');
    console.error('Exemple : DEVIS_API_KEY=dsk_votrecle node test.js');
    process.exit(1);
}

const baseUrl = process.env.DEVIS_API_URL || 'http://localhost:3000/api/v1';

async function test() {
    const client = new DevisExpress({ apiKey, baseUrl });

    console.log('Test 1 : compte');
    const me = await client.account.me();
    console.log('Email :', me.email);
    console.log('Scopes :', me.scopes.join(', '));
    console.log('');

    console.log('Test 2 : liste des devis');
    const quotes = await client.quotes.list({ limit: 5 });
    console.log('Nombre de devis :', quotes.length);
    if (quotes.length > 0) {
        console.log('Premier devis :', quotes[0].number, '-', quotes[0].total, quotes[0].currency);
    }
    console.log('');

    console.log('Test 3 : liste des clients');
    const clients = await client.clients.list({ limit: 5 });
    console.log('Nombre de clients :', clients.length);
    console.log('');

    console.log('Test 4 : statistiques');
    const stats = await client.stats.get();
    console.log('Devis total :', stats.quotes.total);
    console.log('CA accepte :', stats.quotes.revenue);
    console.log('');

    console.log('Tous les tests reussis.');
}

test().catch(err => {
    console.error('Erreur :', err.message);
    if (err.statusCode) {
        console.error('Statut HTTP :', err.statusCode);
    }
    process.exit(1);
});