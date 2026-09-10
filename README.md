# Devis Express Pro

> Générateur de devis professionnels assisté par Intelligence Artificielle.

![Version](https://img.shields.io/badge/version-2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

## - Description

Devis Express Pro est une application web qui transforme automatiquement 
n'importe quelle demande client (PDF, Word, Excel, CSV, TXT) en un devis 
professionnel, grâce à l'Intelligence Artificielle.

**Plus besoin de ressaisir les informations à la main.** L'IA lit le document, 
extrait les articles, applique vos tarifs, et génère un PDF prêt à envoyer.

## - Fonctionnalités

- **Extraction par IA** : Lecture automatique des demandes clients (Groq, KeylessAI, OpenRouter)
- **Formats supportés** : PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV, TXT
- **Paramètres entreprise** : Logo, coordonnées, SIRET, TVA, mentions légales
- **Historique** : Tous les devis générés sont archivés et consultables
- **Envoi par email** : Envoi direct du devis au client via Resend
- **Dashboard** : Statistiques (nombre de devis, montant total, produits populaires)
- **Numérotation automatique** : Chaque devis reçoit un numéro unique (DEVIS-0001-2026)
- **PDF professionnel** : Mise en page propre, lisible et personnalisable

## - Installation

### Pré-requis

- **Node.js** version 18 ou supérieure ([télécharger](https://nodejs.org/))
- **npm** (installé avec Node.js)

### Étapes

```bash
# 1. Cloner le projet
git clone https://github.com/ton-compte/mvp_devis.git
cd mvp_devis

# 2. Installer les dépendances du backend
cd backend
npm install

# 3. Créer le fichier de configuration
cp .env.example .env
# Puis éditer .env avec tes clés API

# 4. Lancer le serveur
npm start