// backend/scripts/generate-missing-icons.js
// Génère les icônes manquantes à partir d'une icône existante

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', '..', 'frontend', 'icons');
const WANTED_SIZES = [128, 152, 180, 384];

// Chercher une icône source (par ordre de préférence)
const SOURCE_CANDIDATES = [
    'icon-512x512.png',
    'icon-384x384.png',
    'icon-192x192.png',
    'icon-144x144.png',
    'icon-96x96.png'
];

async function generate() {
    // Trouver la source
    let sourcePath = null;
    for (const candidate of SOURCE_CANDIDATES) {
        const fullPath = path.join(ICONS_DIR, candidate);
        if (fs.existsSync(fullPath)) {
            sourcePath = fullPath;
            console.log(`📸 Source utilisée : ${candidate}`);
            break;
        }
    }

    if (!sourcePath) {
        console.error(' Aucune icône source trouvée dans frontend/icons/');
        console.error('   Placez au moins une icône PNG (192x192 ou 512x512) et relancez.');
        process.exit(1);
    }

    // Générer chaque taille manquante
    for (const size of WANTED_SIZES) {
        const targetPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
        
        // Skip si déjà présent
        if (fs.existsSync(targetPath)) {
            console.log(`⏭ icon-${size}x${size}.png existe déjà, ignoré`);
            continue;
        }

        try {
            await sharp(sourcePath)
                .resize(size, size, {
                    fit: 'contain',
                    background: { r: 11, g: 17, b: 32, alpha: 1 } // #0b1120
                })
                .png()
                .toFile(targetPath);
            console.log(` icon-${size}x${size}.png généré`);
        } catch (err) {
            console.error(` Erreur pour ${size}x${size}:`, err.message);
        }
    }

    console.log('\n Génération terminée !');
    console.log(' Vérifiez que les 9 tailles sont présentes :');
    console.log('   72, 96, 128, 144, 152, 180, 192, 384, 512');
}

generate().catch(console.error);