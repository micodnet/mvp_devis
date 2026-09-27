# Pour publier les SDKs (C) et la PWA (D), voici les procédures exactes.

C. Publier les SDKs
1. SDK JavaScript sur npm
Prérequis : créer un compte sur npmjs.com.

## Étapes :

### bash
# 1. Se connecter
cd C:\Users\vermi\Desktop\mvp_devis_v1\sdks\javascript
npm login
# Suivez les instructions (email, mot de passe, code 2FA)

# 2. Vérifier que le package est prêt
npm publish --dry-run
# Cela montre exactement ce qui sera publié, sans rien envoyer

# 3. Publier
npm publish --access public
Vérification : ouvrez https://www.npmjs.com/package/devis-express-pro. Si le package apparaît, c'est réussi.

# Pour les mises à jour futures :

### bash
npm version patch   # 1.0.0 → 1.0.1
npm publish
2. SDK Python sur PyPI
Prérequis : créer un compte sur pypi.org et générer un API Token dans les paramètres du compte.

## Étapes :

### bash
# 1. Installer les outils de build
cd C:\Users\vermi\Desktop\mvp_devis_v1\sdks\python
pip install --upgrade build twine

# 2. Construire le package
python -m build
# Cela crée un dossier dist/ avec les fichiers .whl et .tar.gz

# 3. Vérifier la validité
twine check dist/*
# Attendu : PASSED pour les deux fichiers

# 4. (Recommandé) Tester sur TestPyPI d'abord
twine upload -r testpypi dist/*
pip install -i https://test.pypi.org/simple/ devis-express-pro

# 5. Uploader sur PyPI (avec votre API token)
twine upload dist/*
# Username : __token__
# Password : pypi-votre-token
Vérification : ouvrez https://pypi.org/project/devis-express-pro/.

D. Publier la PWA sur les stores
1. Google Play (Android) — via Bubblewrap

## Prérequis :

Google Play Developer Account (25$ une fois)
Node.js installé

## Étapes :

### bash
# 1. Installer Bubblewrap
npm install -g @bubblewrap/cli

# 2. Créer un dossier de travail
cd C:\Users\vermi\Desktop
mkdir pwa-android && cd pwa-android

# 3. Initialiser avec le manifest de votre PWA
bubblewrap init --manifest=https://mvp-devis.onrender.com/manifest.json

# Bubblewrap va :
# - Lire votre manifest
# - Demander un nom de package (ex: com.micodnet.devisexpresspro)
# - Demander de créer une clé de signature (dites oui la première fois)
# - Générer un projet Android

# 4. Construire le bundle
bubblewrap build
# Cela génère : app-release-bundle.aab (à uploader sur Google Play)
#              app-release-signed.apk (pour tester sur votre téléphone)

Important : consultez le fichier twa-manifest.json généré. Vous devrez ajouter l'empreinte SHA-256 de votre clé dans un fichier assetlinks.json sur votre site web pour la Digital Asset Links (sinon la barre d'URL reste visible).

Upload sur Play Console : allez dans Google Play Console → Créer une application → Upload du .aab.

2. App Store (iOS) — la réalité
Attention : Apple n'accepte pas les PWA pures sur l'App Store. Il faut les wrapper dans un conteneur natif avec Xcode, ou utiliser un service comme PWABuilder.

## Prérequis :

- Compte Apple Developer (99$/an)
- Un Mac (obligatoire pour compiler avec Xcode)

## Étapes :

- Utiliser PWABuilder (gratuit) pour générer le projet Xcode à partir de votre manifest
- Ouvrir le projet dans Xcode
- Configurer le Bundle ID, les icônes, les captures d'écran
- Uploader via Xcode ou Transporter
- Soumettre à App Review

Point critique (Guideline 4.2) : Apple rejette les apps qui sont juste "un site web dans une coquille". Votre app doit offrir des fonctionnalités natives que Safari n'a pas : notifications push natives, mode hors-ligne sans barre d'URL, etc..

Mon conseil : commencez par Google Play (25$ une fois, pas de Mac nécessaire). L'App Store iOS peut attendre — c'est plus cher, plus complexe, et le risque de rejet est élevé pour une PWA.

Ordre recommandé
- Publier le SDK JavaScript (5 minutes, gratuit, utile immédiatement)
- Publier le SDK Python (5 minutes, gratuit, utile immédiatement)
- Publier la PWA sur Google Play (1-2 heures, 25$ une fois)
- App Store iOS (à faire plus tard, si nécessaire)