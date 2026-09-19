// ------------------------------------------------------------
// Séquence d'emails post-inscription (5 emails sur 30 jours)
// Chaque email est envoyé une seule fois par utilisateur,
// tracké dans la table email_log.
// ------------------------------------------------------------

const { Resend } = require('resend');
const { pool } = require('../db');
const { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } = require('./i18n');

// Configuration de la séquence : délai + fonction de génération
const SEQUENCE = [
    {
        type: 'welcome',
        delayDays: 0,
        subject: '🎉 Bienvenue sur Devis Express Pro',
        build: buildWelcomeEmail
    },
    {
        type: 'tips_catalogue',
        delayDays: 1,
        subject: 'Une astuce pour gagner 10 secondes par devis',
        build: buildCatalogueTipsEmail
    },
    {
        type: 'tips_ai',
        delayDays: 3,
        subject: 'Comment nos utilisateurs gagnent 3 heures par jour',
        build: buildAiTipsEmail
    },
    {
        type: 'upgrade_check',
        delayDays: 7,
        subject: 'Vous approchez de votre limite de devis',
        build: buildUpgradeCheckEmail
    },
    {
        type: 'upgrade_offer',
        delayDays: 14,
        subject: 'Prêt à passer à la vitesse supérieure ?',
        build: buildUpgradeOfferEmail
    }
];

// ------------------------------------------------------------
// Vérifie si un utilisateur a déjà reçu un email
// ------------------------------------------------------------
async function hasReceivedEmail(userId, emailType) {
    const result = await pool.query(
        'SELECT id FROM email_log WHERE user_id = $1 AND email_type = $2',
        [userId, emailType]
    );
    return result.rows.length > 0;
}

// ------------------------------------------------------------
// Marque un email comme envoyé
// ------------------------------------------------------------
async function markEmailSent(userId, emailType) {
    await pool.query(
        'INSERT INTO email_log (user_id, email_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, emailType]
    );
}

// ------------------------------------------------------------
// Envoie un email via Resend
// ------------------------------------------------------------
async function sendEmail(to, subject, html) {
    if (!process.env.RESEND_API_KEY) {
        console.warn(`RESEND_API_KEY absente — email non envoyé à ${to}`);
        return false;
    }
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
            to: [to],
            subject,
            html
        });
        if (error) {
            console.error(`Erreur envoi email à ${to}:`, error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error(`Erreur envoi email à ${to}:`, err.message);
        return false;
    }
}

// ------------------------------------------------------------
// Récupère le prénom/nom d'entreprise pour personnaliser
// ------------------------------------------------------------
async function getUserContext(userId) {
    const result = await pool.query(`
        SELECT u.email, u.created_at, u.subscription_plan,
               s.company_name, s.language
        FROM users u
        LEFT JOIN settings s ON s.user_id = u.id
        WHERE u.id = $1
    `, [userId]);
    const row = result.rows[0];
    if (row && !SUPPORTED_LANGUAGES.includes(row.language)) {
        row.language = DEFAULT_LANGUAGE;
    }
    return row || null;
}

// ------------------------------------------------------------
// ORCHESTRATEUR : envoie les emails dus depuis le dernier run
// ------------------------------------------------------------
async function runEmailSequence(baseUrl = 'https://mvp-devis.onrender.com') {
    const stats = { sent: 0, skipped: 0, errors: 0, details: [] };

    for (const step of SEQUENCE) {
        try {
            // Trouver les utilisateurs éligibles :
            // - Inscrits depuis >= delayDays
            // - Qui n'ont pas encore reçu cet email
            // - Qui ne se sont pas désabonnés (deleted_at IS NULL)
            const eligible = await pool.query(`
                SELECT u.id, u.email, u.created_at, u.subscription_plan, s.company_name
                FROM users u
                LEFT JOIN settings s ON s.user_id = u.id
                WHERE u.deleted_at IS NULL
                  AND u.created_at <= NOW() - ($1 || ' days')::INTERVAL
                  AND NOT EXISTS (
                      SELECT 1 FROM email_log el
                      WHERE el.user_id = u.id AND el.email_type = $2
                  )
                LIMIT 100
            `, [step.delayDays, step.type]);

            for (const user of eligible.rows) {
                try {
                    // Contexte supplémentaire selon l'email
                    const context = {
                        email: user.email,
                        companyName: user.company_name || 'votre entreprise',
                        subscriptionPlan: user.subscription_plan,
                        baseUrl,
                        lang: user.language || DEFAULT_LANGUAGE
                    };

                    const html = step.build(context);
                    const sent = await sendEmail(user.email, step.subject, html);

                    if (sent) {
                        await markEmailSent(user.id, step.type);
                        stats.sent++;
                        stats.details.push(`✅ ${step.type} → ${user.email}`);
                    } else {
                        stats.errors++;
                        stats.details.push(`❌ ${step.type} → ${user.email} (échec)`);
                    }
                } catch (userErr) {
                    stats.errors++;
                    stats.details.push(`❌ ${step.type} → ${user.email} : ${userErr.message}`);
                }
            }
        } catch (err) {
            stats.errors++;
            stats.details.push(`❌ Erreur traitement étape ${step.type} : ${err.message}`);
        }
    }

    return stats;
}

// ============================================================
// TEMPLATES D'EMAILS MULTILINGUES
// ============================================================

function emailWrapper(content, lang) {
    const footer = {
        fr: 'Devis Express Pro — Générateur de devis par IA<br>Vous recevez cet email car vous avez créé un compte sur notre plateforme.',
        nl: 'Devis Express Pro — AI offertegenerator<br>U ontvangt deze e-mail omdat u een account hebt aangemaakt.',
        en: 'Devis Express Pro — AI-powered quote generator<br>You received this email because you created an account.'
    }[lang] || 'Devis Express Pro';

    return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
            ${content}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;">
            <p style="font-size:12px;color:#94a3b8;text-align:center;">${footer}</p>
        </div>
    `;
}

function btn(url, label) {
    return `
        <p style="text-align:center;margin:28px 0;">
            <a href="${url}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">${label}</a>
        </p>
    `;
}

function buildWelcomeEmail(ctx) {
    const L = {
        fr: {
            title: 'Bienvenue sur Devis Express Pro 🎉',
            sub: 'Votre compte est prêt.',
            h2: 'Vos 3 premières étapes',
            li1: '<strong>Configurez votre entreprise</strong> — nom, adresse, TVA, logo.',
            li2: '<strong>Ajoutez vos produits</strong> — un par un ou via import CSV/Excel.',
            li3: '<strong>Générez votre premier devis</strong> — déposez une demande client.',
            cta: 'Accéder à mon compte'
        },
        nl: {
            title: 'Welkom bij Devis Express Pro 🎉',
            sub: 'Uw account is klaar.',
            h2: 'Uw eerste 3 stappen',
            li1: '<strong>Configureer uw bedrijf</strong> — naam, adres, btw, logo.',
            li2: '<strong>Voeg uw producten toe</strong> — één voor één of via CSV/Excel-import.',
            li3: '<strong>Genereer uw eerste offerte</strong> — upload een klantaanvraag.',
            cta: 'Naar mijn account'
        },
        en: {
            title: 'Welcome to Devis Express Pro 🎉',
            sub: 'Your account is ready.',
            h2: 'Your first 3 steps',
            li1: '<strong>Configure your company</strong> — name, address, VAT, logo.',
            li2: '<strong>Add your products</strong> — one by one or via CSV/Excel import.',
            li3: '<strong>Generate your first quote</strong> — upload a customer request.',
            cta: 'Go to my account'
        }
    }[ctx.lang] || {};
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:26px;margin-bottom:16px;">${L.title}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.sub}</p>
        <h2 style="color:#0b1120;font-size:18px;margin-top:24px;margin-bottom:12px;">${L.h2}</h2>
        <ol style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>${L.li1}</li>
            <li>${L.li2}</li>
            <li>${L.li3}</li>
        </ol>
        ${btn(ctx.baseUrl, L.cta)}
    `, ctx.lang);
}

function buildCatalogueTipsEmail(ctx) {
    const L = {
        fr: {
            title: 'Une astuce pour gagner 10 secondes par devis',
            p1: 'Savez-vous que vous pouvez importer tout votre catalogue produits en moins de 2 minutes ?',
            p2: 'Préparez un fichier CSV ou Excel avec vos colonnes (nom, référence, prix, catégorie) et glissez-le dans l\'onglet <strong>Catalogue</strong>.',
            p3: 'Résultat : plus besoin de retaper vos prix à chaque devis.',
            cta: 'Importer mon catalogue'
        },
        nl: {
            title: 'Een tip om 10 seconden per offerte te besparen',
            p1: 'Wist u dat u uw volledige productcatalogus in minder dan 2 minuten kunt importeren?',
            p2: 'Bereid een CSV- of Excel-bestand voor met uw kolommen (naam, referentie, prijs, categorie) en sleep het naar het tabblad <strong>Catalogus</strong>.',
            p3: 'Resultaat: geen prijzen meer opnieuw intypen voor elke offerte.',
            cta: 'Catalogus importeren'
        },
        en: {
            title: 'A tip to save 10 seconds per quote',
            p1: 'Did you know you can import your entire product catalog in under 2 minutes?',
            p2: 'Prepare a CSV or Excel file with your columns (name, reference, price, category) and drop it into the <strong>Catalog</strong> tab.',
            p3: 'Result: no more retyping prices for each quote.',
            cta: 'Import my catalog'
        }
    }[ctx.lang] || {};
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">${L.title}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p1}</p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p2}</p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p3}</p>
        ${btn(ctx.baseUrl, L.cta)}
    `, ctx.lang);
}

function buildAiTipsEmail(ctx) {
    const L = {
        fr: {
            title: 'Comment nos utilisateurs gagnent 3 heures par jour',
            p1: 'Un artisan type passe en moyenne <strong>2h30 à 3h par jour</strong> à faire des devis manuellement.',
            p2: 'Avec Devis Express Pro, cette même personne fait ses devis en <strong>10 secondes</strong> :',
            li1: 'Elle dépose la demande du client (PDF, Word, email)',
            li2: 'L\'IA extrait les articles et les associe à son catalogue',
            li3: 'Le devis est prêt, elle l\'envoie au client',
            cta: 'Générer un devis'
        },
        nl: {
            title: 'Hoe onze gebruikers 3 uur per dag besparen',
            p1: 'Een typische vakman besteedt gemiddeld <strong>2u30 tot 3u per dag</strong> aan handmatige offertes.',
            p2: 'Met Devis Express Pro maakt dezelfde persoon zijn offertes in <strong>10 seconden</strong>:',
            li1: 'Hij uploadt de klantaanvraag (PDF, Word, e-mail)',
            li2: 'De AI extraheert de items en koppelt ze aan zijn catalogus',
            li3: 'De offerte is klaar, hij stuurt ze naar de klant',
            cta: 'Offerte genereren'
        },
        en: {
            title: 'How our users save 3 hours a day',
            p1: 'A typical tradesman spends on average <strong>2h30 to 3h per day</strong> doing manual quotes.',
            p2: 'With Devis Express Pro, the same person makes their quotes in <strong>10 seconds</strong>:',
            li1: 'They upload the customer request (PDF, Word, email)',
            li2: 'The AI extracts items and matches them to their catalog',
            li3: 'The quote is ready, they send it to the customer',
            cta: 'Generate a quote'
        }
    }[ctx.lang] || {};
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">${L.title}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p1}</p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p2}</p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>${L.li1}</li>
            <li>${L.li2}</li>
            <li>${L.li3}</li>
        </ul>
        ${btn(ctx.baseUrl, L.cta)}
    `, ctx.lang);
}

function buildUpgradeCheckEmail(ctx) {
    const L = {
        fr: {
            title: 'Vous approchez de votre limite',
            p1: 'Ça fait une semaine que vous utilisez Devis Express Pro. Vous êtes sur le <strong>plan Free</strong>, qui vous permet de générer <strong>3 devis par mois</strong>.',
            p2: 'Si vous approchez de cette limite, il est peut-être temps de passer au plan <strong>Starter</strong> (19 €/mois) :',
            li1: '50 devis par mois',
            li2: 'Envoi par email automatique',
            li3: 'Support prioritaire',
            p3: 'Soit <strong>0,38 € par devis</strong> pour économiser 3 heures de travail. Le calcul est vite fait.',
            cta: 'Voir les plans'
        },
        nl: {
            title: 'U nadert uw limiet',
            p1: 'Het is een week geleden dat u Devis Express Pro gebruikt. U zit op het <strong>Gratis plan</strong>, waarmee u <strong>3 offertes per maand</strong> kunt genereren.',
            p2: 'Als u deze limiet nadert, is het misschien tijd om over te stappen naar het <strong>Starter</strong>-plan (19 €/maand):',
            li1: '50 offertes per maand',
            li2: 'Automatische e-mailverzending',
            li3: 'Prioritaire ondersteuning',
            p3: 'Dat is <strong>0,38 € per offerte</strong> om 3 uur werk te besparen.',
            cta: 'Bekijk plannen'
        },
        en: {
            title: 'You are approaching your limit',
            p1: 'It\'s been a week since you started using Devis Express Pro. You are on the <strong>Free plan</strong>, which allows <strong>3 quotes per month</strong>.',
            p2: 'If you\'re approaching this limit, it might be time to upgrade to the <strong>Starter</strong> plan (19 €/month):',
            li1: '50 quotes per month',
            li2: 'Automatic email sending',
            li3: 'Priority support',
            p3: 'That\'s <strong>0.38 € per quote</strong> to save 3 hours of work.',
            cta: 'See plans'
        }
    }[ctx.lang] || {};
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">${L.title}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p1}</p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p2}</p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>${L.li1}</li>
            <li>${L.li2}</li>
            <li>${L.li3}</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p3}</p>
        ${btn(ctx.baseUrl, L.cta)}
    `, ctx.lang);
}

function buildUpgradeOfferEmail(ctx) {
    const L = {
        fr: {
            title: 'Prêt à passer à la vitesse supérieure ?',
            p1: 'Cela fait maintenant 2 semaines que vous utilisez notre outil.',
            p2: 'Voici ce que nos utilisateurs préfèrent dans les plans payants :',
            li1: '<strong>Starter (19 €/mois)</strong> : 50 devis, envoi par email, TVA configurable',
            li2: '<strong>Pro (49 €/mois)</strong> : 200 devis, stats avancées, support prioritaire',
            li3: '<strong>Entreprise (99 €/mois)</strong> : devis illimités, multi-utilisateurs, API',
            p3: 'Passez à un plan payant pour continuer à utiliser Devis Express Pro sans interruption.',
            cta: 'Choisir mon plan'
        },
        nl: {
            title: 'Klaar om een versnelling hoger te schakelen?',
            p1: 'Het is nu 2 weken geleden dat u onze tool gebruikt.',
            p2: 'Dit is wat onze gebruikers het beste vinden aan de betaalde plannen:',
            li1: '<strong>Starter (19 €/maand)</strong>: 50 offertes, e-mailverzending, configureerbare btw',
            li2: '<strong>Pro (49 €/maand)</strong>: 200 offertes, geavanceerde statistieken, prioritaire ondersteuning',
            li3: '<strong>Enterprise (99 €/maand)</strong>: onbeperkte offertes, multi-gebruikers, API',
            p3: 'Upgrade om Devis Express Pro zonder onderbreking te blijven gebruiken.',
            cta: 'Mijn plan kiezen'
        },
        en: {
            title: 'Ready to shift into higher gear?',
            p1: 'It\'s been 2 weeks since you started using our tool.',
            p2: 'Here\'s what our users like most about the paid plans:',
            li1: '<strong>Starter (19 €/month)</strong>: 50 quotes, email sending, configurable VAT',
            li2: '<strong>Pro (49 €/month)</strong>: 200 quotes, advanced stats, priority support',
            li3: '<strong>Enterprise (99 €/month)</strong>: unlimited quotes, multi-user, API',
            p3: 'Upgrade to keep using Devis Express Pro without interruption.',
            cta: 'Choose my plan'
        }
    }[ctx.lang] || {};
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">${L.title}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p1}</p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p2}</p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>${L.li1}</li>
            <li>${L.li2}</li>
            <li>${L.li3}</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;color:#334155;">${L.p3}</p>
        ${btn(ctx.baseUrl, L.cta)}
    `, ctx.lang);
}

// ============================================================
// TEMPLATES D'EMAILS (retournent du HTML) français
// ============================================================

// function emailWrapper(content) {
//     return `
//         <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
//             ${content}
//             <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;">
//             <p style="font-size:12px;color:#94a3b8;text-align:center;">
//                 Devis Express Pro — Générateur de devis par IA<br>
//                 Vous recevez cet email car vous avez créé un compte sur notre plateforme.
//             </p>
//         </div>
//     `;
// }

// function btn(url, label) {
//     return `
//         <p style="text-align:center;margin:28px 0;">
//             <a href="${url}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">${label}</a>
//         </p>
//     `;
// }

// // -------- Email 1 : Bienvenue (J+0) --------
// function buildWelcomeEmail(ctx) {
//     return emailWrapper(`
//         <h1 style="color:#0b1120;font-size:26px;margin-bottom:16px;">Bienvenue sur Devis Express Pro 🎉</h1>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">Votre compte est prêt.</p>
//         <h2 style="color:#0b1120;font-size:18px;margin-top:24px;margin-bottom:12px;">Vos 3 premières étapes</h2>
//         <ol style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
//             <li><strong>Configurez votre entreprise</strong> — nom, adresse, TVA, logo.</li>
//             <li><strong>Ajoutez vos produits</strong> — un par un ou via import CSV/Excel.</li>
//             <li><strong>Générez votre premier devis</strong> — déposez une demande client.</li>
//         </ol>
//         ${btn(ctx.baseUrl, 'Accéder à mon compte')}
//     `);
// }

// // -------- Email 2 : Astuce catalogue (J+1) -----
// function buildCatalogueTipsEmail(ctx) {
//     return emailWrapper(`
//         <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Une astuce pour gagner 10 secondes par devis</h1>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Bonjour,
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Savez-vous que vous pouvez importer tout votre catalogue produits en moins de 2 minutes ?
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Préparez un fichier CSV ou Excel avec vos colonnes (nom, référence, prix, catégorie) et glissez-le dans l'onglet <strong>Catalogue</strong>. Notre IA associera automatiquement les produits aux demandes clients.
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Résultat : plus besoin de retaper vos prix à chaque devis.
//         </p>
//         ${btn(ctx.baseUrl, 'Importer mon catalogue')}
//     `);
// }

// // -------- Email 3 : Histoire / Preuve (J+3) -----
// function buildAiTipsEmail(ctx) {
//     return emailWrapper(`
//         <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Comment nos utilisateurs gagnent 3 heures par jour</h1>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Bonjour,
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Un artisan type passe en moyenne <strong>2h30 à 3h par jour</strong> à faire des devis manuellement.
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Avec Devis Express Pro, cette même personne fait ses devis en <strong>10 secondes</strong> :
//         </p>
//         <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
//             <li>Elle dépose la demande du client (PDF, Word, email)</li>
//             <li>L'IA extrait les articles et les associe à son catalogue</li>
//             <li>Le devis est prêt, elle l'envoie au client</li>
//         </ul>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Vous avez déjà généré des devis cette semaine ? Vous voyez la différence.
//         </p>
//         ${btn(ctx.baseUrl, 'Générer un devis')}
//     `);
// }

// // -------- Email 4 : Limite atteinte (J+7) --------
// function buildUpgradeCheckEmail(ctx) {
//     return emailWrapper(`
//         <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Vous approchez de votre limite</h1>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Bonjour,
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Ça fait une semaine que vous utilisez Devis Express Pro. Vous êtes sur le <strong>plan Free</strong>, qui vous permet de générer <strong>3 devis par mois</strong>.
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Si vous approchez de cette limite, il est peut-être temps de passer au plan <strong>Starter</strong> (19 €/mois) :
//         </p>
//         <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
//             <li>50 devis par mois</li>
//             <li>Envoi par email automatique</li>
//             <li>Support prioritaire</li>
//         </ul>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Soit <strong>0,38 € par devis</strong> pour économiser 3 heures de travail. Le calcul est vite fait.
//         </p>
//         ${btn(ctx.baseUrl, 'Voir les plans')}
//     `);
// }

// // -------- Email 5 : Upgrade (J+14) --------
// function buildUpgradeOfferEmail(ctx) {
//     return emailWrapper(`
//         <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Prêt à passer à la vitesse supérieure ?</h1>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Bonjour,
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Cela fait maintenant 2 semaines que vous utilisez notre outil. J'espère que l'IA vous fait gagner un temps précieux.
//         </p>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Voici ce que nos utilisateurs préfèrent dans les plans payants :
//         </p>
//         <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
//             <li><strong>Starter (19 €/mois)</strong> : 50 devis, envoi par email, TVA configurable</li>
//             <li><strong>Pro (49 €/mois)</strong> : 200 devis, stats avancées, support prioritaire</li>
//             <li><strong>Entreprise (99 €/mois)</strong> : devis illimités, multi-utilisateurs, API</li>
//         </ul>
//         <p style="font-size:15px;line-height:1.6;color:#334155;">
//             Passez à un plan payant pour continuer à utiliser Devis Express Pro sans interruption.
//         </p>
//         ${btn(ctx.baseUrl, 'Choisir mon plan')}
//     `);
// }

module.exports = { runEmailSequence, SEQUENCE };

//Automatiser avec cron-job.org
// Une fois validé en local, crée un cron sur cron-job.org (gratuit) :
// Crée un compte (gratuit, pas de CB)
// New cronjob :
// Title: Séquence emails Devis Express
// URL: https://mvp-devis.onrender.com/api/admin/run-email-sequence
// Schedule : Every day at 09:00 (ou ce que tu veux)
// Request method : POST
// Request body : {"baseUrl": "https://mvp-devis.onrender.com"}
// Headers :
// Key : Content-Type / Value : application/json
// Key : x-admin-key / Value : TA_CLE_ADMIN
// Sauvegarder