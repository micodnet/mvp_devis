# SDK Python - Devis Express Pro

SDK officiel Python pour l'API Devis Express Pro.

## Installation

```bash
pip install devis-express-pro

## Utilisation
from devis_express import DevisExpress

client = DevisExpress(api_key="dsk_votre_cle")

## Compte
me = client.account.me()
print(me["email"])

## Devis
# Liste
quotes = client.quotes.list(limit=10)

# Filtre par statut
accepted = client.quotes.list(status="accepted")

# Detail
quote = client.quotes.get(42)

# Creation
result = client.quotes.create(
    items=[
        {"name": "Peinture murs", "qty": 1, "unitPrice": 500},
        {"name": "Main d oeuvre", "qty": 8, "unitPrice": 45}
    ],
    client_name="Dupont SARL",
    client_email="contact@dupont.be"
)
print(result["quote"]["number"])

# Clients
clients = client.clients.list()

new_client = client.clients.create(
    name="Martin SA",
    email="info@martin.be",
    phone="+32 2 123 45 67"
)

# Produits
products = client.products.list(limit=50)

# Factures
invoices = client.invoices.list(status="overdue")

# Chantiers
chantiers = client.chantiers.list()

# Statistiques
stats = client.stats.get()
print("CA accepte :", stats["quotes"]["revenue"])

# Options avancees
client = DevisExpress(
    api_key="dsk_xxx",
    base_url="https://votre-domaine.com/api/v1",
    timeout=15
)

# Gestion des erreurs
from devis_express import DevisExpressError

try:
    client.quotes.get(99999)
except DevisExpressError as e:
    print("Statut HTTP :", e.status_code)
    print("Message :", e.message)

## Licence MIT
## Fichier 10 : `sdks/python/test.py`
"""
Test du SDK Python.
Usage : DEVIS_API_KEY=dsk_xxx python test.py
"""

import os
import sys
from devis_express import DevisExpress, DevisExpressError

api_key = os.environ.get("DEVIS_API_KEY")
base_url = os.environ.get("DEVIS_API_URL", "http://localhost:3000/api/v1")

if not api_key:
    print("Variable DEVIS_API_KEY requise.")
    print("Exemple : DEVIS_API_KEY=dsk_votrecle python test.py")
    sys.exit(1)

client = DevisExpress(api_key=api_key, base_url=base_url)

try:
    print("Test 1 : compte")
    me = client.account.me()
    print("Email :", me["email"])
    print("Scopes :", ", ".join(me["scopes"]))
    print()

    print("Test 2 : liste des devis")
    quotes = client.quotes.list(limit=5)
    print("Nombre de devis :", len(quotes))
    if quotes:
        print("Premier devis :", quotes[0]["number"], "-", quotes[0]["total"], quotes[0]["currency"])
    print()

    print("Test 3 : liste des clients")
    clients = client.clients.list(limit=5)
    print("Nombre de clients :", len(clients))
    print()

    print("Test 4 : statistiques")
    stats = client.stats.get()
    print("Devis total :", stats["quotes"]["total"])
    print("CA accepte :", stats["quotes"]["revenue"])
    print()

    print("Tous les tests reussis.")

except DevisExpressError as e:
    print("Erreur :", e.message)
    if e.status_code:
        print("Statut HTTP :", e.status_code)
    sys.exit(1)

Test rapide des SDK
Test JS
bash
cd C:\Users\vermi\Desktop\mvp_devis_v1\sdks\javascript
set DEVIS_API_KEY=dsk_votre_cle
set DEVIS_API_URL=http://localhost:3000/api/v1
node test.js
Sous PowerShell :

powershell
$env:DEVIS_API_KEY="dsk_votre_cle"
$env:DEVIS_API_URL="http://localhost:3000/api/v1"
node test.js
Test Python
bash
cd C:\Users\vermi\Desktop\mvp_devis_v1\sdks\python
set DEVIS_API_KEY=dsk_votre_cle
set DEVIS_API_URL=http://localhost:3000/api/v1
python test.py
Sous PowerShell :

powershell
$env:DEVIS_API_KEY="dsk_votre_cle"
$env:DEVIS_API_URL="http://localhost:3000/api/v1"
python test.py

########################################################

Test OAuth
Test 1 : Creer une application OAuth
Onglet OAuth → + Nouvelle application

Nom : Test App

URL de redirection : https://webhook.site/votre-id (ou http://localhost:4000/callback)

Cocher read

Cliquer Creer

Resultat : le modal affiche client_id et client_secret. Copiez-les.

Test 2 : Flux Authorization Code complet
Ouvrez cette URL dans un navigateur (connecte) :

text
http://localhost:3000/api/oauth/authorize?client_id=VOTRE_CLIENT_ID&redirect_uri=VOTRE_URL&response_type=code&scope=read&state=test123
La page de consentement s'affiche

Cliquez Autoriser

Vous etes redirige vers VOTRE_URL?code=xxx&state=test123

Copiez le code.

Test 3 : Echange code contre token
bash
curl -X POST http://localhost:3000/api/oauth/token ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "grant_type=authorization_code&code=LE_CODE&redirect_uri=VOTRE_URL&client_id=VOTRE_CLIENT_ID&client_secret=VOTRE_SECRET"
Reponse attendue :

json
{
    "access_token": "doa_...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_token": "dor_...",
    "scope": "read"
}
Test 4 : Utiliser le token
bash
curl -H "Authorization: Bearer VOTRE_ACCESS_TOKEN" http://localhost:3000/api/oauth-v1/me
curl -H "Authorization: Bearer VOTRE_ACCESS_TOKEN" http://localhost:3000/api/oauth-v1/quotes
Test 5 : Refresh
bash
curl -X POST http://localhost:3000/api/oauth/token ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "grant_type=refresh_token&refresh_token=VOTRE_REFRESH_TOKEN&client_id=VOTRE_CLIENT_ID&client_secret=VOTRE_SECRET"
Test 6 : Client credentials (server-to-server)
bash
curl -X POST http://localhost:3000/api/oauth/token ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "grant_type=client_credentials&client_id=VOTRE_CLIENT_ID&client_secret=VOTRE_SECRET"
Test 7 : Introspect
bash
curl -X POST http://localhost:3000/api/oauth/introspect ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "token=VOTRE_ACCESS_TOKEN"
Test 8 : Revoke
bash
curl -X POST http://localhost:3000/api/oauth/revoke ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "token=VOTRE_ACCESS_TOKEN"