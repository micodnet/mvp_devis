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