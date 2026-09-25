const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const SOURCE = path.join(__dirname, '..', '..', 'frontend', 'icons', 'source.png');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'frontend', 'icons');

async function generate() {
    if (!fs.existsSync(SOURCE)) {
        console.error('❌ Fichier source.png manquant dans frontend/icons/');
        process.exit(1);
    }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const size of SIZES) {
        const output = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
        await sharp(SOURCE)
            .resize(size, size)
            .png()
            .toFile(output);
        console.log(`✅ ${size}x${size}`);
    }

    console.log('🎉 Toutes les icônes générées !');
}

generate().catch(console.error);

// npm install sharp