const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', '..', 'frontend', 'icons');
const SUBFOLDERS = ['android', 'ios', 'windows', 'mstile'];
const WANTED_SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];

function flatten() {
    console.log(' Analyse du dossier icons...\n');

    // 1. Parcourir les sous-dossiers et copier les fichiers trouvés
    let copied = 0;

    function walkDir(dir, depth = 0) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walkDir(fullPath, depth + 1);
            } else if (entry.isFile() && /\.(png|jpg|jpeg|svg|ico)$/i.test(entry.name)) {
                // Extraire la taille du nom de fichier (ex: icon-192x192.png → 192)
                const match = entry.name.match(/(\d+)x\1/);
                if (match) {
                    const size = match[1];
                    const targetPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
                    
                    // Ne pas écraser si le fichier est déjà à la racine
                    if (fullPath !== targetPath) {
                        fs.copyFileSync(fullPath, targetPath);
                        console.log(` ${size}x${size} copié (depuis ${path.relative(ICONS_DIR, fullPath)})`);
                        copied++;
                    }
                }
            }
        }
    }

    walkDir(ICONS_DIR);

    // 2. Vérifier que toutes les tailles attendues sont présentes
    console.log('\n Vérification des tailles attendues...\n');
    const missing = [];
    for (const size of WANTED_SIZES) {
        const target = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
        if (fs.existsSync(target)) {
            console.log(` icon-${size}x${size}.png`);
        } else {
            console.log(` icon-${size}x${size}.png MANQUANT`);
            missing.push(size);
        }
    }

    console.log(`\n Résumé : ${copied} fichier(s) copié(s)`);
    if (missing.length > 0) {
        console.log(` ${missing.length} taille(s) manquante(s) : ${missing.join(', ')}`);
        console.log(` Générez ces tailles manuellement ou utilisez un générateur.`);
    } else {
        console.log(' Toutes les icônes sont présentes !');
    }
}

flatten();