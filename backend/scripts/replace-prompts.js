// backend/scripts/replace-prompts.js
// Remplace automatiquement les prompt() et confirm() par des modales generiques
// A executer une seule fois sur frontend/index.html

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'frontend', 'index.html');

if (!fs.existsSync(FILE)) {
    console.error('Fichier introuvable :', FILE);
    process.exit(1);
}

let content = fs.readFileSync(FILE, 'utf-8');
const original = content;

// Table de remplacement : [regex, remplacement, description]
// IMPORTANT : les remplacements sont faits dans l'ordre. Si une regex est trop large, elle peut casser le code.
const replacements = [
    // ==========================================
    // CONFIRMATIONS SIMPLES
    // ==========================================
    {
        regex: /if \(confirm\('Se déconnecter \?'\)\) \{\s*\n(\s*)clearToken\(\);\s*\n\s*showLanding\(\);\s*\n\s*\}/g,
        replacement: `if (await showConfirm({ title: 'Deconnexion', message: 'Voulez-vous vraiment vous deconnecter ?', confirmText: 'Se deconnecter', danger: true })) {\n$1clearToken();\n$1showLanding();\n        }`,
        desc: 'Se deconnecter'
    },
    {
        regex: /if \(!confirm\('Supprimer ce client \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le client', message: 'Le client sera retire de votre carnet.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer client'
    },
    {
        regex: /if \(!confirm\('Supprimer ce service \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le service', message: 'Le service sera retire de votre liste.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer service'
    },
    {
        regex: /if \(!confirm\('Supprimer ce fournisseur \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le fournisseur', message: 'Le fournisseur sera retire de votre carnet.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer fournisseur'
    },
    {
        regex: /if \(!confirm\('Générer automatiquement les commandes fournisseurs à partir des alertes de stock \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Generer les commandes', message: 'Creer des bons de commande a partir des alertes de stock ?', confirmText: 'Generer' });\n            if (!_ok) return;`,
        desc: 'Generer PO'
    },
    {
        regex: /if \(!confirm\('Réceptionner cette commande \? Le stock sera mis à jour automatiquement\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Receptionner la commande', message: 'Le stock sera mis a jour automatiquement.', confirmText: 'Receptionner' });\n            if (!_ok) return;`,
        desc: 'Receptionner commande'
    },
    {
        regex: /if \(!confirm\('Supprimer ce brouillon de commande \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le brouillon', message: 'Le brouillon sera supprime.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer brouillon'
    },
    {
        regex: /if \(!confirm\('Supprimer ce produit \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le produit', message: 'Le produit sera retire de votre catalogue.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer produit'
    },
    {
        regex: /if \(!confirm\(`Changer le statut vers "\$\{labels\[next\]\}" \?`\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Changer le statut', message: 'Passer au statut "' + labels[next] + '" ?', confirmText: 'Changer' });\n            if (!_ok) return;`,
        desc: 'Changer statut'
    },
    {
        regex: /if \(!confirm\('Dupliquer ce devis \? Un nouveau brouillon sera créé\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Dupliquer le devis', message: 'Un nouveau brouillon sera cree.', confirmText: 'Dupliquer' });\n            if (!_ok) return;`,
        desc: 'Dupliquer devis'
    },
    {
        regex: /if \(!confirm\('Supprimer ce devis définitivement \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le devis', message: 'Cette action est irreversible.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer devis'
    },
    {
        regex: /if \(!confirm\(`Envoyer ce devis à \$\{email\} \?`\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Envoyer au client', message: 'Envoyer le devis a ' + email + ' ?', confirmText: 'Envoyer' });\n                    if (!_ok) return;`,
        desc: 'Envoyer devis'
    },
    {
        regex: /if \(!confirm\('Marquer cette facture comme non payée \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Marquer non payee', message: 'Confirmer le passage en "Non payee" ?', confirmText: 'Marquer' });\n            if (!_ok) return;`,
        desc: 'Marquer non payee'
    },
    {
        regex: /if \(!confirm\(`Changer le statut vers "\$\{labels\[next\]\}" \?`\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Changer le statut', message: 'Passer au statut "' + labels[next] + '" ?', confirmText: 'Changer' });\n            if (!_ok) return;`,
        desc: 'Changer statut facture (2)'
    },
    {
        regex: /if \(!confirm\('Envoyer cette facture via Peppol \?\\n\\nLa facture sera envoyée au client via le réseau Peppol\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Envoyer via Peppol', message: 'La facture sera transmise au client via le reseau Peppol.', confirmText: 'Envoyer' });\n            if (!_ok) return;`,
        desc: 'Envoyer Peppol'
    },
    {
        regex: /if \(!confirm\('Supprimer cette facture définitivement \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la facture', message: 'Cette action est irreversible.', confirmText: 'Supprimer', danger: true });\n            if (!_ok) return;`,
        desc: 'Supprimer facture'
    },
    {
        regex: /if \(!confirm\('Envoyer une relance par email au client \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Envoyer une relance', message: 'Un email de relance sera envoye au client.', confirmText: 'Envoyer' });\n            if (!_ok) return;`,
        desc: 'Envoyer relance'
    },
    {
        regex: /if \(!confirm\('Dupliquer cette facture \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Dupliquer la facture', message: 'Une nouvelle facture sera creee.', confirmText: 'Dupliquer' });\n            if (!_ok) return;`,
        desc: 'Dupliquer facture'
    },
    {
        regex: /if \(!confirm\(`Créer une facture à partir du devis \$\{quote\.quoteNumber\} \?`\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Creer une facture', message: 'A partir du devis ' + quote.quoteNumber + ' ?', confirmText: 'Creer' });\n                if (!_ok) return;`,
        desc: 'Facture depuis devis'
    },
    {
        regex: /if \(confirm\('Effacer la conversation \?'\)\) clearHistory\(\);/g,
        replacement: `if (await showConfirm({ title: 'Effacer la conversation', message: 'Tout l\'historique du chat sera supprime.', confirmText: 'Effacer', danger: true })) clearHistory();`,
        desc: 'Effacer conversation'
    },
    {
        regex: /if \(!confirm\('Détacher ce devis du chantier \? Le devis ne sera pas supprimé\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Detacher le devis', message: 'Le devis ne sera pas supprime, juste retire du chantier.', confirmText: 'Detacher' });\n                if (!_ok) return;`,
        desc: 'Detacher devis'
    },
    {
        regex: /if \(!confirm\('Facturer tous les devis acceptés du chantier \?\\n\\nUne seule facture sera créée avec tous les devis\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Facturer le chantier', message: 'Une seule facture sera creee avec tous les devis acceptes.', confirmText: 'Facturer' });\n                if (!_ok) return;`,
        desc: 'Facturer chantier'
    },
    {
        regex: /if \(!confirm\('Supprimer cette photo \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la photo', message: 'La photo sera supprimee definitivement.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer photo'
    },
    {
        regex: /if \(!confirm\('Retirer cet appareil des notifications \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Retirer l\'appareil', message: 'Cet appareil ne recevra plus de notifications.', confirmText: 'Retirer', danger: true });\n                if (!_ok) return;`,
        desc: 'Retirer appareil'
    },
    {
        regex: /if \(!confirm\('Supprimer cette mission \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la mission', message: 'La mission sera supprimee definitivement.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer mission'
    },
    {
        regex: /if \(!confirm\('Revoquer cette cle \? Les applications qui l\\'utilisent cesseront de fonctionner\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Revoquer la cle', message: 'Les applications qui l\\'utilisent cesseront de fonctionner.', confirmText: 'Revoquer', danger: true });\n                if (!_ok) return;`,
        desc: 'Revoquer cle'
    },
    {
        regex: /if \(!confirm\('Supprimer definitivement cette cle \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la cle', message: 'Action irreversible.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer cle'
    },
    {
        regex: /if \(!confirm\('Supprimer ce webhook \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer le webhook', message: 'Les evenements ne seront plus envoyes.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer webhook'
    },
    {
        regex: /if \(!confirm\('Supprimer cette application \? Tous les jetons associes seront revoques\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer l\\'application', message: 'Tous les jetons associes seront revoques.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer app OAuth'
    },
    {
        regex: /if \(!confirm\('Revoquer ce jeton \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Revoquer le jeton', message: 'L\\'acces sera immediatement revoque.', confirmText: 'Revoquer', danger: true });\n                if (!_ok) return;`,
        desc: 'Revoquer jeton'
    },
    {
        regex: /if \(!confirm\('Reinitialiser l\\'onboarding et relancer la visite \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Reinitialiser la visite', message: 'La visite guidee sera relancee au prochain chargement.', confirmText: 'Reinitialiser' });\n            if (!_ok) return;`,
        desc: 'Reinitialiser onboarding'
    },
    {
        regex: /if \(!confirm\('Quitter la demo \? Toutes les donnees seront perdues\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Quitter la demo', message: 'Toutes les donnees seront perdues.', confirmText: 'Quitter', danger: true });\n                if (!_ok) return;`,
        desc: 'Quitter demo'
    },
    {
        regex: /if \(!confirm\('Mettre cette regle en pause \? Les factures ne seront plus emises automatiquement\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Mettre en pause', message: 'Les factures ne seront plus emises automatiquement.', confirmText: 'Pause' });\n                if (!_ok) return;`,
        desc: 'Pause recurrence'
    },
    {
        regex: /if \(!confirm\('Reprendre cette regle \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Reprendre la regle', message: 'Les factures seront a nouveau emises.', confirmText: 'Reprendre' });\n                if (!_ok) return;`,
        desc: 'Reprendre recurrence'
    },
    {
        regex: /if \(!confirm\('Supprimer cette regle \? Les factures deja emises seront conservees\.'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la regle', message: 'Les factures deja emises seront conservees.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer recurrence'
    },
    {
        regex: /if \(!confirm\('Forcer l\\'emission des factures dues maintenant \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Forcer l\\'emission', message: 'Emettre immediatement les factures dues ?', confirmText: 'Emettre' });\n                if (!_ok) return;`,
        desc: 'Forcer emission'
    },
    {
        regex: /if \(!confirm\('Supprimer cette variante \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Supprimer la variante', message: 'La variante sera supprimee.', confirmText: 'Supprimer', danger: true });\n                if (!_ok) return;`,
        desc: 'Supprimer variante'
    },
    {
        regex: /if \(!confirm\('Valider ce bon de commande \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Valider le BC', message: 'Le BC passera en statut "Envoye".', confirmText: 'Valider' });\n                if (!_ok) return;`,
        desc: 'Valider BC'
    },
    {
        regex: /if \(!confirm\('Envoyer le bon de commande a ' \+ email \+ ' \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Envoyer le BC', message: 'Envoyer a ' + email + ' ?', confirmText: 'Envoyer' });\n                if (!_ok) return;`,
        desc: 'Envoyer BC'
    },
    {
        regex: /if \(!confirm\('Renvoyer l\\'invitation a ' \+ email \+ ' \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Renvoyer l\\'invitation', message: 'Une nouvelle invitation sera envoyee a ' + email + '.', confirmText: 'Envoyer' });\n                if (!_ok) return;`,
        desc: 'Renvoyer invitation'
    },
    {
        regex: /if \(!confirm\('Desactiver l\\'acces de ce client a son portail \?'\)\) return;/g,
        replacement: `const _ok = await showConfirm({ title: 'Desactiver l\\'acces', message: 'Le client ne pourra plus acceder a son portail.', confirmText: 'Desactiver', danger: true });\n                if (!_ok) return;`,
        desc: 'Desactiver acces client'
    },
    {
        regex: /if \(confirm\('Lien de paiement genere et copie\.\\n\\nVoulez-vous l\\'ouvrir dans un nouvel onglet pour tester \?'\)\) \{/g,
        replacement: `const _openIt = await showConfirm({ title: 'Tester le lien', message: 'Voulez-vous ouvrir le lien dans un nouvel onglet ?', confirmText: 'Ouvrir' });\n            if (_openIt) {`,
        desc: 'Ouvrir lien paiement'
    },

    // ==========================================
    // PROMPTS (SAISIE)
    // ==========================================
    {
        regex: /const depositInput = prompt\('Créer un acompte \? \(entrez un pourcentage 30\/50, ou laissez vide pour facture complète\)'\);/g,
        replacement: `const depositInput = await showPrompt({ title: 'Creer un acompte', message: 'Entrez un pourcentage (30, 50...) ou laissez vide pour une facture complete.', label: 'Pourcentage', inputType: 'number', placeholder: '30' });`,
        desc: 'Acompte'
    },
    {
        regex: /email = prompt\('Aucun email dans ce devis\. Saisissez l\\'email du client :', ''\);/g,
        replacement: `email = await showPrompt({ title: 'Email du client', message: 'Aucun email dans ce devis.', label: 'Email', inputType: 'email', placeholder: 'client@exemple.com' });`,
        desc: 'Email devis'
    },
    {
        regex: /const method = prompt\('Mode de paiement \(virement, carte, espèces, autre\) :', 'virement'\);/g,
        replacement: `const method = await showPrompt({ title: 'Mode de paiement', label: 'Mode de paiement', type: 'select', defaultValue: 'virement', options: [{value:'virement',label:'Virement bancaire'},{value:'carte',label:'Carte bancaire'},{value:'especes',label:'Especes'},{value:'cheque',label:'Cheque'},{value:'autre',label:'Autre'}] });`,
        desc: 'Mode paiement (autre)'
    },
    {
        regex: /const method = prompt\('Mode de paiement \(virement, carte, espèces, chèque\) :', 'virement'\);/g,
        replacement: `const method = await showPrompt({ title: 'Mode de paiement', label: 'Mode de paiement', type: 'select', defaultValue: 'virement', options: [{value:'virement',label:'Virement bancaire'},{value:'carte',label:'Carte bancaire'},{value:'especes',label:'Especes'},{value:'cheque',label:'Cheque'}] });`,
        desc: 'Mode paiement (cheque)'
    },
    {
        regex: /const method = prompt\('Mode de paiement \(virement, cheque, especes\) :', 'virement'\);/g,
        replacement: `const method = await showPrompt({ title: 'Mode de paiement', label: 'Mode de paiement', type: 'select', defaultValue: 'virement', options: [{value:'virement',label:'Virement'},{value:'cheque',label:'Cheque'},{value:'especes',label:'Especes'}] });`,
        desc: 'Mode paiement (simple)'
    },
    {
        regex: /const amountInput = prompt\(`Montant du paiement reçu \(€\) :\\nMontant total : \$\{total\.toFixed\(2\)\} €`, total\.toFixed\(2\)\);/g,
        replacement: `const amountInput = await showPrompt({ title: 'Enregistrer un paiement', message: 'Montant total de la facture : ' + total.toFixed(2) + ' EUR', label: 'Montant recu (EUR)', defaultValue: total.toFixed(2), inputType: 'number' });`,
        desc: 'Montant paiement'
    },
    {
        regex: /const reason = prompt\('Raison de l\\'avoir :', 'Annulation'\);/g,
        replacement: `const reason = await showPrompt({ title: 'Creer un avoir', label: 'Raison de l\\'avoir', defaultValue: 'Annulation', placeholder: 'Erreur de facturation...' });`,
        desc: 'Raison avoir'
    },
    {
        regex: /const amountInput = prompt\('Montant de l\\'avoir \(€\) :'\);/g,
        replacement: `const amountInput = await showPrompt({ title: 'Montant de l\\'avoir', label: 'Montant (EUR)', inputType: 'number', placeholder: '0.00' });`,
        desc: 'Montant avoir'
    },
    {
        regex: /const hours = prompt\('Heures reelles passees \(optionnel\) :', ''\);/g,
        replacement: `const hours = await showPrompt({ title: 'Heures passees', message: 'Optionnel.', label: 'Nombre d\\'heures', inputType: 'number', placeholder: '0' });`,
        desc: 'Heures passees'
    },
    {
        regex: /const num = prompt\('Numero de facture recue :', ''\);/g,
        replacement: `const num = await showPrompt({ title: 'Numero de facture recue', label: 'Numero', placeholder: 'FAC-2026-001' });`,
        desc: 'Num facture recue'
    },
    {
        regex: /const date = prompt\('Date de la facture \(YYYY-MM-DD\) :', new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\);/g,
        replacement: `const date = await showPrompt({ title: 'Date de la facture', label: 'Date (AAAA-MM-JJ)', defaultValue: new Date().toISOString().slice(0, 10) });`,
        desc: 'Date facture recue'
    },
    {
        regex: /const amount = prompt\('Montant \(EUR\) :', ''\);/g,
        replacement: `const amount = await showPrompt({ title: 'Montant', label: 'Montant (EUR)', inputType: 'number', placeholder: '0.00' });`,
        desc: 'Montant (sous-traitant)'
    },
    {
        regex: /email = prompt\('Email du fournisseur :', ''\);/g,
        replacement: `email = await showPrompt({ title: 'Email du fournisseur', label: 'Email', inputType: 'email', placeholder: 'fournisseur@exemple.com' });`,
        desc: 'Email fournisseur'
    },
    {
        regex: /const email = prompt\('Email du client \(laisser vide pour utiliser l\\'email du client\) :', ''\);/g,
        replacement: `const email = await showPrompt({ title: 'Email du client', message: 'Laisser vide pour utiliser l\\'email du compte client.', label: 'Email', inputType: 'email', placeholder: 'client@exemple.com' });`,
        desc: 'Email portail client'
    },
    {
        regex: /prompt\('Lien de paiement \(copiez-le\) :', data\.url\);/g,
        replacement: `await showPrompt({ title: 'Lien de paiement', message: 'Copiez ce lien et envoyez-le a votre client.', label: 'Lien', defaultValue: data.url });`,
        desc: 'Lien paiement fallback'
    },

    // ==========================================
    // AVOIR TOTAL/PARTIEL (special : confirm avec sens inverse)
    // ==========================================
    {
        regex: /const partial = confirm\('Créer un avoir total \?\\n\\nOK = avoir total\\nAnnuler = avoir partiel'\);/g,
        replacement: `const creditChoice = await showChoice({ title: 'Type d\\'avoir', message: 'Choisissez le type d\\'avoir a creer.', choices: [{value:'full',label:'Avoir total'},{value:'partial',label:'Avoir partiel'}] });\n        if (!creditChoice) return;\n        const partial = creditChoice === 'full';`,
        desc: 'Type avoir'
    }
];

// ==========================================
// APPLIQUER LES REMPLACEMENTS
// ==========================================
let count = 0;
const details = [];

for (const r of replacements) {
    const before = content.length;
    const matches = content.match(r.regex);
    if (matches) {
        content = content.replace(r.regex, r.replacement);
        const replaced = matches.length;
        count += replaced;
        details.push('  ' + replaced + 'x ' + r.desc);
    }
}

// ==========================================
// VERIFIER CE QU'IL RESTE
// ==========================================
const remainingPrompts = (content.match(/[^.]prompt\(/g) || []).length - 2; // -2 pour deferredPrompt.prompt() et deferredPWAPrompt.prompt()
const remainingConfirms = (content.match(/[^.]confirm\(/g) || []).length;

console.log('');
console.log('========================================');
console.log('REMPLACEMENT TERMINE');
console.log('========================================');
console.log('');
console.log(count + ' occurrence(s) remplacee(s) :');
details.forEach(d => console.log(d));
console.log('');
console.log('Restant :');
console.log('  prompt() : ' + Math.max(0, remainingPrompts));
console.log('  confirm() : ' + Math.max(0, remainingConfirms));
console.log('');

if (content !== original) {
    // Sauvegarder l'original en backup
    const backupFile = FILE + '.backup-' + Date.now();
    fs.writeFileSync(backupFile, original, 'utf-8');
    console.log('Backup cree : ' + backupFile);

    // Ecrire le nouveau contenu
    fs.writeFileSync(FILE, content, 'utf-8');
    console.log('Fichier mis a jour : ' + FILE);
} else {
    console.log('Aucune modification appliquee.');
}

console.log('');