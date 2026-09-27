Récapitulatif complet du projet

Backend (backend/) Routes (30 fichiers) :

- auth — inscription, connexion, mot de passe oublié
- stripe — abonnements, checkout, portail client
- products — catalogue produits
- clients — carnet clients
- quotes — devis
- admin — administration
- team — équipe multi-utilisateurs
- invoices — factures
- services — prestations
- suppliers — fournisseurs
- stock — gestion du stock
- assistant — assistant IA
- peppol — facturation électronique
- signature — signature eIDAS
- stats — statistiques
- chantiers — chantiers + photos + timeline
- currency — multi-devises
- subcontractors — sous-traitants
- api-keys — clés API
- api-public — API v1
- api-docs — documentation Swagger
- webhooks — webhooks sortants
- oauth — serveur OAuth 2.0
- oauth-api — API via OAuth
- push — notifications push
- demo — mode démo
- onboarding — visite guidée
- reports — rapports PDF
- email-import — import email
- public-verify — vérification publique de signature
- Modules métier (backend/utils/) :
- assistant/ — orchestrator, router, tools, actions, metiers, - - - - preferences, observations
- peppol/ — UBL generator, Storecove client
- signature/ — eidas-signer
- stats/ — analytics
- chantiers/ — helpers
- currency/ — rates
- subcontractors/ — helpers
- api/ — auth par clé
- webhooks/ — dispatcher
- oauth/ — helpers
- push/ — notifications
- demo/ — seed
- reports/ — PDF generator
- email/ — importer
- excel/ — exporter

Frontend (frontend/) Onglets disponibles :

- Devis
- Clients
- Catalogue
- Services
- Fournisseurs
- Stock
- Historique
- Factures
- Dashboard
- Analytics
- Chantiers
- Sous-traitants
- API
- Webhooks
- OAuth
- Équipe
- Paramètres
- Assistant
- Abonnement
- Rapports
- Import email

Fonctionnalités transverses :

- Assistant IA (chat flottant + onglet)
- Mode vocal (Web Speech API) avec Continu/Auto
- PWA (manifest, service worker, icônes)
- Notifications push
- Onboarding (checklist + visite guidée)
- Mode démo (30 min, auto-cleanup)
- Refonte mobile (bottom nav, drawer, cartes)

SDKs (sdks/):
- javascript/ — SDK Node.js publié sur npm (à publier)
- python/ — SDK Python publié sur PyPI (à publier)