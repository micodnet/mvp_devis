// frontend/i18n.js
// Système i18n côté client — FR / NL / EN

const TRANSLATIONS = {
    fr: {
        // Navigation
        "nav.pricing": "Tarifs",
        "nav.login": "Se connecter",
        "nav.signup": "Créer un compte",
        "nav.logout": "Déconnexion",

        // Landing
        "landing.eyebrow": "Propulsé par l'IA",
        "landing.hero_title_1": "Générez vos devis en",
        "landing.hero_title_2": "10 secondes",
        "landing.hero_title_3": "au lieu de 3 heures.",
        "landing.hero_sub": "Déposez n'importe quelle demande client (PDF, Word, Excel, email) et obtenez un devis professionnel prêt à envoyer. L'IA extrait les articles, applique vos tarifs, calcule la TVA et génère le PDF.",
        "landing.cta_primary": "🚀 Essayer gratuitement",
        "landing.cta_secondary": "J'ai déjà un compte",

        "landing.step1.label": "Demande client",
        "landing.step1.sub": "PDF, Word, Excel, CSV",
        "landing.step2.label": "Analyse IA",
        "landing.step2.sub": "Extraction automatique",
        "landing.step3.label": "Devis prêt",
        "landing.step3.sub": "PDF signé & envoyé",

        "landing.feature1.title": "Gagnez 3h par jour",
        "landing.feature1.desc": "Fini la saisie manuelle. Collez un document, l'IA fait le reste.",
        "landing.feature2.title": "Catalogue produits",
        "landing.feature2.desc": "Importez votre catalogue en CSV ou Excel. L'IA associe automatiquement les demandes clients à vos références.",
        "landing.feature3.title": "Carnet clients",
        "landing.feature3.desc": "Enregistrez vos clients une fois pour toutes. Sélectionnez-les en un clic.",

        "pricing.title_1": "Des tarifs",
        "pricing.title_2": "simples",
        "pricing.title_3": "et transparents",
        "pricing.sub": "Commencez gratuitement. Passez à un plan supérieur quand vous en avez besoin.",
        "pricing.popular": "Populaire",
        "pricing.plan.free": "Free",
        "pricing.plan.starter": "Starter",
        "pricing.plan.pro": "Pro",
        "pricing.plan.entreprise": "Entreprise",
        "pricing.per_month": "/mois",
        "pricing.cta.free": "Commencer gratuitement",
        "pricing.cta.choose": "Choisir",

        // Auth
        "auth.login_title": "Connectez-vous ou créez votre compte",
        "auth.email": "Email",
        "auth.password": "Mot de passe",
        "auth.forgot": "Mot de passe oublié ?",
        "auth.login_btn": "Se connecter",
        "auth.signup_btn": "Créer mon compte",
        "auth.toggle_login": "Pas encore de compte ?",
        "auth.toggle_signup": "Déjà un compte ?",
        "auth.toggle_link_login": "Créer un compte",
        "auth.toggle_link_signup": "Se connecter",
        "auth.back_home": "← Retour à l'accueil",
        "auth.terms": "J'accepte les",
        "auth.terms_cgu": "CGU/CGV",
        "auth.terms_and": "et la",
        "auth.terms_privacy": "politique de confidentialité",

        // App
        "app.tab.quotes": "📄 Devis",
        "app.tab.clients": "👥 Clients",
        "app.tab.products": "📦 Catalogue",
        "app.tab.history": "📜 Devis",
        "app.tab.invoices": "🧾 Factures",
        "app.tab.dashboard": "📊 Dashboard",
        "app.tab.team": "👥 Équipe",
        "app.tab.settings": "⚙️ Paramètres",
        "app.tab.subscription": "💳 Abonnement",
        "app.subtitle": "⚡ IA + Gestion complète",

        // Dashboard
        "dash.welcome": "🚀 Bienvenue, commençons !",
        "dash.welcome_sub": "3 étapes pour être opérationnel.",
        "dash.step1.title": "Configurer mon entreprise",
        "dash.step2.title": "Créer mon premier client",
        "dash.step3.title": "Générer mon premier devis",
        "dash.stats": "📊 Vos statistiques",
        "dash.stat.quotes": "Devis générés",
        "dash.stat.amount": "Montant total TTC",
        "dash.stat.accepted": "Devis acceptés",
        "dash.stat.conversion": "Taux d'acceptation",
        "dash.top_products": "🏆 Produits les plus demandés",
        "dash.revenue_chart": "📈 Chiffre d'affaires (12 derniers mois)",
        "dash.status_chart": "🥧 Répartition des devis par statut",

        // Settings
        "settings.title": "🏢 Paramètres de l'entreprise",
        "settings.company_name": "Nom de l'entreprise *",
        "settings.address": "Adresse",
        "settings.siret": "SIRET / BCE",
        "settings.tva": "Numéro de TVA",
        "settings.phone": "Téléphone",
        "settings.email": "Email",
        "settings.website": "Site web",
        "settings.vat_section": "💰 TVA",
        "settings.vat_regime": "Régime de TVA",
        "settings.vat_franchise": "Franchise (pas de TVA) — Auto-entrepreneur",
        "settings.vat_assujetti": "Assujetti (TVA applicable) — Société",
        "settings.vat_rate": "Taux de TVA par défaut (%)",
        "settings.bank_section": "🏦 Coordonnées bancaires & Facturation",
        "settings.iban": "IBAN",
        "settings.bic": "BIC / SWIFT",
        "settings.bank_name": "Nom de la banque",
        "settings.invoice_prefix": "Préfixe n° de facture",
        "settings.payment_terms": "Délai de paiement (jours)",
        "settings.signature_section": "✍️ Signature électronique",
        "settings.signature_method": "Méthode de signature par défaut",
        "settings.sig_none": "Aucune (devis sans signature)",
        "settings.sig_checkbox": "Case à cocher (acceptation électronique)",
        "settings.sig_draw": "Signature dessinée (manuscrite)",
        "settings.logo": "Logo (PNG ou JPEG)",
        "settings.save": "💾 Enregistrer",
        "settings.language_section": "🌍 Langue",
        "settings.language": "Langue de l'interface et des documents",
        "settings.lang_fr": "Français",
        "settings.lang_nl": "Nederlands",
        "settings.lang_en": "English",

        // Équipe
        "team.title": "👥 Mon équipe",
        "team.invite": "+ Inviter un membre",
        "team.upgrade_hint": "Invitez vos collaborateurs",
        "team.upgrade_desc": "Votre plan actuel autorise 1 seul membre. Passez à Pro (3 membres) ou Entreprise (10 membres).",
        "team.see_plans": "Voir les plans",

        // Factures
        "invoices.title": "🧾 Mes factures",
        "invoices.new": "+ Nouvelle facture",
        "invoices.status.draft": "Brouillon",
        "invoices.status.sent": "Envoyée",
        "invoices.status.paid": "Payée",
        "invoices.status.overdue": "En retard",
        "invoices.status.cancelled": "Annulée",

        // Boutons communs
        "btn.actions": "Actions",
        "btn.save": "Enregistrer",
        "btn.cancel": "Annuler",
        "btn.delete": "Supprimer",
        "btn.edit": "Modifier",
        "btn.download_pdf": "Télécharger le PDF",
        "btn.send_email": "Envoyer par email",
        "btn.new_quote": "Nouveau devis",
        "btn.duplicate": "Dupliquer"
    },

    nl: {
        // Navigation
        "nav.pricing": "Prijzen",
        "nav.login": "Inloggen",
        "nav.signup": "Account aanmaken",
        "nav.logout": "Uitloggen",

        // Landing
        "landing.eyebrow": "Aangedreven door AI",
        "landing.hero_title_1": "Genereer uw offertes in",
        "landing.hero_title_2": "10 seconden",
        "landing.hero_title_3": "in plaats van 3 uur.",
        "landing.hero_sub": "Upload een klantaanvraag (PDF, Word, Excel, e-mail) en ontvang een professionele offerte. De AI extraheert de items, past uw tarieven toe, berekent btw en genereert de PDF.",
        "landing.cta_primary": "🚀 Gratis proberen",
        "landing.cta_secondary": "Ik heb al een account",

        "landing.step1.label": "Klantaanvraag",
        "landing.step1.sub": "PDF, Word, Excel, CSV",
        "landing.step2.label": "AI-analyse",
        "landing.step2.sub": "Automatische extractie",
        "landing.step3.label": "Offerte klaar",
        "landing.step3.sub": "PDF ondertekend & verzonden",

        "landing.feature1.title": "Bespaar 3 uur per dag",
        "landing.feature1.desc": "Geen handmatige invoer meer. Upload een document, de AI doet de rest.",
        "landing.feature2.title": "Productcatalogus",
        "landing.feature2.desc": "Importeer uw catalogus in CSV of Excel. De AI koppelt automatisch klantaanvragen aan uw referenties.",
        "landing.feature3.title": "Klantenbestand",
        "landing.feature3.desc": "Registreer uw klanten eenmalig. Selecteer ze met één klik.",

        "pricing.title_1": "Eenvoudige",
        "pricing.title_2": "prijzen",
        "pricing.title_3": "en transparant",
        "pricing.sub": "Begin gratis. Upgrade wanneer u meer nodig heeft.",
        "pricing.popular": "Populair",
        "pricing.plan.free": "Gratis",
        "pricing.plan.starter": "Starter",
        "pricing.plan.pro": "Pro",
        "pricing.plan.entreprise": "Enterprise",
        "pricing.per_month": "/maand",
        "pricing.cta.free": "Gratis starten",
        "pricing.cta.choose": "Kiezen",

        // Auth
        "auth.login_title": "Log in of maak een account aan",
        "auth.email": "E-mail",
        "auth.password": "Wachtwoord",
        "auth.forgot": "Wachtwoord vergeten?",
        "auth.login_btn": "Inloggen",
        "auth.signup_btn": "Account aanmaken",
        "auth.toggle_login": "Nog geen account?",
        "auth.toggle_signup": "Al een account?",
        "auth.toggle_link_login": "Account aanmaken",
        "auth.toggle_link_signup": "Inloggen",
        "auth.back_home": "← Terug naar home",
        "auth.terms": "Ik accepteer de",
        "auth.terms_cgu": "AV/AVV",
        "auth.terms_and": "en het",
        "auth.terms_privacy": "privacybeleid",

        // App
        "app.tab.quotes": "📄 Offertes",
        "app.tab.clients": "👥 Klanten",
        "app.tab.products": "📦 Catalogus",
        "app.tab.history": "📜 Offertes",
        "app.tab.invoices": "🧾 Facturen",
        "app.tab.dashboard": "📊 Dashboard",
        "app.tab.team": "👥 Team",
        "app.tab.settings": "⚙️ Instellingen",
        "app.tab.subscription": "💳 Abonnement",
        "app.subtitle": "⚡ AI + Volledig beheer",

        // Dashboard
        "dash.welcome": "🚀 Welkom, laten we beginnen!",
        "dash.welcome_sub": "3 stappen om operationeel te zijn.",
        "dash.step1.title": "Bedrijf configureren",
        "dash.step2.title": "Eerste klant aanmaken",
        "dash.step3.title": "Eerste offerte genereren",
        "dash.stats": "📊 Uw statistieken",
        "dash.stat.quotes": "Offertes gegenereerd",
        "dash.stat.amount": "Totaalbedrag incl. btw",
        "dash.stat.accepted": "Geaccepteerde offertes",
        "dash.stat.conversion": "Acceptatiepercentage",
        "dash.top_products": "🏆 Meest gevraagde producten",
        "dash.revenue_chart": "📈 Omzet (laatste 12 maanden)",
        "dash.status_chart": "🥧 Offertes per status",

        // Settings
        "settings.title": "🏢 Bedrijfsinstellingen",
        "settings.company_name": "Bedrijfsnaam *",
        "settings.address": "Adres",
        "settings.siret": "KBO / SIRET",
        "settings.tva": "BTW-nummer",
        "settings.phone": "Telefoon",
        "settings.email": "E-mail",
        "settings.website": "Website",
        "settings.vat_section": "💰 Btw",
        "settings.vat_regime": "Btw-regeling",
        "settings.vat_franchise": "Vrijstelling (geen btw) — Zelfstandige",
        "settings.vat_assujetti": "Btw-plichtig — Vennootschap",
        "settings.vat_rate": "Standaard btw-tarief (%)",
        "settings.bank_section": "🏦 Bankgegevens & Facturatie",
        "settings.iban": "IBAN",
        "settings.bic": "BIC / SWIFT",
        "settings.bank_name": "Banknaam",
        "settings.invoice_prefix": "Factuurnummer voorvoegsel",
        "settings.payment_terms": "Betalingstermijn (dagen)",
        "settings.signature_section": "✍️ Elektronische handtekening",
        "settings.signature_method": "Standaard handtekeningmethode",
        "settings.sig_none": "Geen (offerte zonder handtekening)",
        "settings.sig_checkbox": "Aankruisvak (elektronische aanvaarding)",
        "settings.sig_draw": "Getekende handtekening",
        "settings.logo": "Logo (PNG of JPEG)",
        "settings.save": "💾 Opslaan",
        "settings.language_section": "🌍 Taal",
        "settings.language": "Taal van interface en documenten",
        "settings.lang_fr": "Français",
        "settings.lang_nl": "Nederlands",
        "settings.lang_en": "English",

        // Team
        "team.title": "👥 Mijn team",
        "team.invite": "+ Lid uitnodigen",
        "team.upgrade_hint": "Nodig uw medewerkers uit",
        "team.upgrade_desc": "Uw huidige plan staat slechts 1 lid toe. Upgrade naar Pro (3 leden) of Enterprise (10 leden).",
        "team.see_plans": "Bekijk plannen",

        // Facturen
        "invoices.title": "🧾 Mijn facturen",
        "invoices.new": "+ Nieuwe factuur",
        "invoices.status.draft": "Concept",
        "invoices.status.sent": "Verzonden",
        "invoices.status.paid": "Betaald",
        "invoices.status.overdue": "Achterstallig",
        "invoices.status.cancelled": "Geannuleerd",

        // Boutons communs
        "btn.actions": "Acties",
        "btn.save": "Opslaan",
        "btn.cancel": "Annuleren",
        "btn.delete": "Verwijderen",
        "btn.edit": "Bewerken",
        "btn.download_pdf": "PDF downloaden",
        "btn.send_email": "Verzenden via e-mail",
        "btn.new_quote": "Nieuwe offerte",
        "btn.duplicate": "Dupliceren"
    },

    en: {
        // Navigation
        "nav.pricing": "Pricing",
        "nav.login": "Log in",
        "nav.signup": "Sign up",
        "nav.logout": "Logout",

        // Landing
        "landing.eyebrow": "AI-Powered",
        "landing.hero_title_1": "Generate your quotes in",
        "landing.hero_title_2": "10 seconds",
        "landing.hero_title_3": "instead of 3 hours.",
        "landing.hero_sub": "Upload any customer request (PDF, Word, Excel, email) and get a professional quote ready to send. The AI extracts items, applies your prices, calculates VAT and generates the PDF.",
        "landing.cta_primary": "🚀 Try for free",
        "landing.cta_secondary": "I already have an account",

        "landing.step1.label": "Customer request",
        "landing.step1.sub": "PDF, Word, Excel, CSV",
        "landing.step2.label": "AI Analysis",
        "landing.step2.sub": "Automatic extraction",
        "landing.step3.label": "Quote ready",
        "landing.step3.sub": "PDF signed & sent",

        "landing.feature1.title": "Save 3 hours a day",
        "landing.feature1.desc": "No more manual input. Upload a document, the AI does the rest.",
        "landing.feature2.title": "Product catalog",
        "landing.feature2.desc": "Import your catalog in CSV or Excel. The AI automatically matches customer requests to your references.",
        "landing.feature3.title": "Customer directory",
        "landing.feature3.desc": "Register your customers once. Select them in one click.",

        "pricing.title_1": "Simple",
        "pricing.title_2": "pricing",
        "pricing.title_3": "and transparent",
        "pricing.sub": "Start free. Upgrade when you need more.",
        "pricing.popular": "Popular",
        "pricing.plan.free": "Free",
        "pricing.plan.starter": "Starter",
        "pricing.plan.pro": "Pro",
        "pricing.plan.entreprise": "Enterprise",
        "pricing.per_month": "/month",
        "pricing.cta.free": "Start for free",
        "pricing.cta.choose": "Choose",

        // Auth
        "auth.login_title": "Log in or create your account",
        "auth.email": "Email",
        "auth.password": "Password",
        "auth.forgot": "Forgot your password?",
        "auth.login_btn": "Log in",
        "auth.signup_btn": "Create account",
        "auth.toggle_login": "No account yet?",
        "auth.toggle_signup": "Already have an account?",
        "auth.toggle_link_login": "Create account",
        "auth.toggle_link_signup": "Log in",
        "auth.back_home": "← Back to home",
        "auth.terms": "I accept the",
        "auth.terms_cgu": "Terms",
        "auth.terms_and": "and the",
        "auth.terms_privacy": "privacy policy",

        // App
        "app.tab.quotes": "📄 Quotes",
        "app.tab.clients": "👥 Clients",
        "app.tab.products": "📦 Catalog",
        "app.tab.history": "📜 Quotes",
        "app.tab.invoices": "🧾 Invoices",
        "app.tab.dashboard": "📊 Dashboard",
        "app.tab.team": "👥 Team",
        "app.tab.settings": "⚙️ Settings",
        "app.tab.subscription": "💳 Subscription",
        "app.subtitle": "⚡ AI + Full management",

        // Dashboard
        "dash.welcome": "🚀 Welcome, let's get started!",
        "dash.welcome_sub": "3 steps to be operational.",
        "dash.step1.title": "Configure my company",
        "dash.step2.title": "Create my first client",
        "dash.step3.title": "Generate my first quote",
        "dash.stats": "📊 Your statistics",
        "dash.stat.quotes": "Quotes generated",
        "dash.stat.amount": "Total amount (incl.)",
        "dash.stat.accepted": "Accepted quotes",
        "dash.stat.conversion": "Acceptance rate",
        "dash.top_products": "🏆 Most requested products",
        "dash.revenue_chart": "📈 Revenue (last 12 months)",
        "dash.status_chart": "🥧 Quotes by status",

        // Settings
        "settings.title": "🏢 Company settings",
        "settings.company_name": "Company name *",
        "settings.address": "Address",
        "settings.siret": "VAT/Company ID",
        "settings.tva": "VAT number",
        "settings.phone": "Phone",
        "settings.email": "Email",
        "settings.website": "Website",
        "settings.vat_section": "💰 VAT",
        "settings.vat_regime": "VAT regime",
        "settings.vat_franchise": "Exemption (no VAT) — Sole trader",
        "settings.vat_assujetti": "VAT registered — Company",
        "settings.vat_rate": "Default VAT rate (%)",
        "settings.bank_section": "🏦 Bank details & Invoicing",
        "settings.iban": "IBAN",
        "settings.bic": "BIC / SWIFT",
        "settings.bank_name": "Bank name",
        "settings.invoice_prefix": "Invoice prefix",
        "settings.payment_terms": "Payment terms (days)",
        "settings.signature_section": "✍️ Electronic signature",
        "settings.signature_method": "Default signature method",
        "settings.sig_none": "None (quote without signature)",
        "settings.sig_checkbox": "Checkbox (electronic acceptance)",
        "settings.sig_draw": "Drawn signature",
        "settings.logo": "Logo (PNG or JPEG)",
        "settings.save": "💾 Save",
        "settings.language_section": "🌍 Language",
        "settings.language": "Interface and documents language",
        "settings.lang_fr": "Français",
        "settings.lang_nl": "Nederlands",
        "settings.lang_en": "English",

        // Team
        "team.title": "👥 My team",
        "team.invite": "+ Invite a member",
        "team.upgrade_hint": "Invite your colleagues",
        "team.upgrade_desc": "Your current plan allows only 1 member. Upgrade to Pro (3 members) or Enterprise (10 members).",
        "team.see_plans": "See plans",

        // Invoices
        "invoices.title": "🧾 My invoices",
        "invoices.new": "+ New invoice",
        "invoices.status.draft": "Draft",
        "invoices.status.sent": "Sent",
        "invoices.status.paid": "Paid",
        "invoices.status.overdue": "Overdue",
        "invoices.status.cancelled": "Cancelled",

        // Common buttons
        "btn.actions": "Actions",
        "btn.save": "Save",
        "btn.cancel": "Cancel",
        "btn.delete": "Delete",
        "btn.edit": "Edit",
        "btn.download_pdf": "Download PDF",
        "btn.send_email": "Send by email",
        "btn.new_quote": "New quote",
        "btn.duplicate": "Duplicate"
    }
};

let currentLang = 'fr';

function setLanguage(lang) {
    if (!TRANSLATIONS[lang]) lang = 'fr';
    currentLang = lang;
    localStorage.setItem('devis_lang', lang);
    document.documentElement.lang = lang;
    applyTranslations();
}

function getLanguage() {
    return currentLang;
}

function t(key) {
    return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS['fr']?.[key] || key;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const value = t(key);
        if (value && value !== key) {
            // Si l'élément a des enfants (ex: <span>), on remplace le texte par défaut
            if (el.children.length === 0) {
                el.textContent = value;
            } else {
                // Pour les éléments avec enfants, on remplace uniquement le noeud texte direct
                for (const node of el.childNodes) {
                    if (node.nodeType === 3 && node.textContent.trim()) {
                        node.textContent = value;
                        break;
                    }
                }
            }
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
}

// Initialisation au chargement
(function initI18n() {
    const saved = localStorage.getItem('devis_lang');
    if (saved && TRANSLATIONS[saved]) {
        currentLang = saved;
        document.documentElement.lang = saved;
    }
    // applyTranslations sera appelé après le chargement du DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyTranslations);
    } else {
        applyTranslations();
    }
})();