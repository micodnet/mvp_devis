# SDK JavaScript - Devis Express Pro

SDK officiel pour l'API Devis Express Pro.

## Installation

```bash
npm install devis-express-pro

### Utilisation
const DevisExpress = require('devis-express-pro');

const client = new DevisExpress({
    apiKey: 'dsk_votre_cle_api'
});

#### Compte
const me = await client.account.me();
console.log(me.email);

##### Devis
// Liste
const quotes = await client.quotes.list({ limit: 10 });

// Filtre par statut
const accepted = await client.quotes.list({ status: 'accepted' });

// Detail
const quote = await client.quotes.get(42);

// Creation
const result = await client.quotes.create({
    items: [
        { name: 'Peinture murs', qty: 1, unitPrice: 500 },
        { name: 'Main d oeuvre', qty: 8, unitPrice: 45 }
    ],
    clientName: 'Dupont SARL',
    clientEmail: 'contact@dupont.be'
});
console.log(result.quote.number);

###### Clients
const clients = await client.clients.list();

const newClient = await client.clients.create({
    name: 'Martin SA',
    email: 'info@martin.be',
    phone: '+32 2 123 45 67'
});

####### Produits
const products = await client.products.list({ limit: 50 });

######## Factures
const invoices = await client.invoices.list({ status: 'overdue' });

######### Chantiers
const chantiers = await client.chantiers.list();

########## Statistiques
const stats = await client.stats.get();
console.log('CA accepte :', stats.quotes.revenue);

########### Options avancees
const client = new DevisExpress({
    apiKey: 'dsk_xxx',
    baseUrl: 'https://votre-domaine.com/api/v1',
    timeout: 15000
});

############ Gestion des erreurs
try {
    await client.quotes.get(99999);
} catch (err) {
    if (err instanceof DevisExpress.DevisExpressError) {
        console.error('Statut HTTP :', err.statusCode);
        console.error('Message :', err.message);
    }
}

#############Licence MIT
## SDK Python
**Emplacement :** dossier `sdks/python/` à la racine du projet.

## Fichier 6 : `sdks/python/pyproject.toml`

## Créez ce fichier :
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "devis-express-pro"
version = "1.0.0"
description = "SDK Python officiel pour l'API Devis Express Pro"
readme = "README.md"
requires-python = ">=3.8"
license = { text = "MIT" }
authors = [
    { name = "Micodnet" }
]
keywords = ["devis", "facturation", "api", "peppol"]
classifiers = [
    "Programming Language :: Python :: 3",
    "License :: OSI Approved :: MIT License",
    "Operating System :: OS Independent"
]
dependencies = []

[project.urls]
Homepage = "https://mvp-devis.onrender.com"
Repository = "https://github.com/micodnet/mvp_devis"

[tool.setuptools]
packages = ["devis_express"]
