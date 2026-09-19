// ------------------------------------------------------------
// Séquence d'emails post-inscription (5 emails sur 30 jours)
// Chaque email est envoyé une seule fois par utilisateur,
// tracké dans la table email_log.
// ------------------------------------------------------------

const { Resend } = require('resend');
const { pool } = require('../db');

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
               s.company_name
        FROM users u
        LEFT JOIN settings s ON s.user_id = u.id
        WHERE u.id = $1
    `, [userId]);
    return result.rows[0] || null;
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
                        baseUrl
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
// TEMPLATES D'EMAILS (retournent du HTML)
// ============================================================

function emailWrapper(content) {
    return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
            ${content}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;">
            <p style="font-size:12px;color:#94a3b8;text-align:center;">
                Devis Express Pro — Générateur de devis par IA<br>
                Vous recevez cet email car vous avez créé un compte sur notre plateforme.
            </p>
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

// -------- Email 1 : Bienvenue (J+0) --------
function buildWelcomeEmail(ctx) {
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:26px;margin-bottom:16px;">Bienvenue sur Devis Express Pro 🎉</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">Votre compte est prêt.</p>
        <h2 style="color:#0b1120;font-size:18px;margin-top:24px;margin-bottom:12px;">Vos 3 premières étapes</h2>
        <ol style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li><strong>Configurez votre entreprise</strong> — nom, adresse, TVA, logo.</li>
            <li><strong>Ajoutez vos produits</strong> — un par un ou via import CSV/Excel.</li>
            <li><strong>Générez votre premier devis</strong> — déposez une demande client.</li>
        </ol>
        ${btn(ctx.baseUrl, 'Accéder à mon compte')}
    `);
}

// -------- Email 2 : Astuce catalogue (J+1) -----
function buildCatalogueTipsEmail(ctx) {
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Une astuce pour gagner 10 secondes par devis</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Bonjour,
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Savez-vous que vous pouvez importer tout votre catalogue produits en moins de 2 minutes ?
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Préparez un fichier CSV ou Excel avec vos colonnes (nom, référence, prix, catégorie) et glissez-le dans l'onglet <strong>Catalogue</strong>. Notre IA associera automatiquement les produits aux demandes clients.
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Résultat : plus besoin de retaper vos prix à chaque devis.
        </p>
        ${btn(ctx.baseUrl, 'Importer mon catalogue')}
    `);
}

// -------- Email 3 : Histoire / Preuve (J+3) -----
function buildAiTipsEmail(ctx) {
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Comment nos utilisateurs gagnent 3 heures par jour</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Bonjour,
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Un artisan type passe en moyenne <strong>2h30 à 3h par jour</strong> à faire des devis manuellement.
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Avec Devis Express Pro, cette même personne fait ses devis en <strong>10 secondes</strong> :
        </p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>Elle dépose la demande du client (PDF, Word, email)</li>
            <li>L'IA extrait les articles et les associe à son catalogue</li>
            <li>Le devis est prêt, elle l'envoie au client</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Vous avez déjà généré des devis cette semaine ? Vous voyez la différence.
        </p>
        ${btn(ctx.baseUrl, 'Générer un devis')}
    `);
}

// -------- Email 4 : Limite atteinte (J+7) --------
function buildUpgradeCheckEmail(ctx) {
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Vous approchez de votre limite</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Bonjour,
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Ça fait une semaine que vous utilisez Devis Express Pro. Vous êtes sur le <strong>plan Free</strong>, qui vous permet de générer <strong>3 devis par mois</strong>.
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Si vous approchez de cette limite, il est peut-être temps de passer au plan <strong>Starter</strong> (19 €/mois) :
        </p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li>50 devis par mois</li>
            <li>Envoi par email automatique</li>
            <li>Support prioritaire</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Soit <strong>0,38 € par devis</strong> pour économiser 3 heures de travail. Le calcul est vite fait.
        </p>
        ${btn(ctx.baseUrl, 'Voir les plans')}
    `);
}

// -------- Email 5 : Upgrade (J+14) --------
function buildUpgradeOfferEmail(ctx) {
    return emailWrapper(`
        <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">Prêt à passer à la vitesse supérieure ?</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Bonjour,
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Cela fait maintenant 2 semaines que vous utilisez notre outil. J'espère que l'IA vous fait gagner un temps précieux.
        </p>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Voici ce que nos utilisateurs préfèrent dans les plans payants :
        </p>
        <ul style="font-size:15px;line-height:1.8;color:#334155;padding-left:20px;">
            <li><strong>Starter (19 €/mois)</strong> : 50 devis, envoi par email, TVA configurable</li>
            <li><strong>Pro (49 €/mois)</strong> : 200 devis, stats avancées, support prioritaire</li>
            <li><strong>Entreprise (99 €/mois)</strong> : devis illimités, multi-utilisateurs, API</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;color:#334155;">
            Passez à un plan payant pour continuer à utiliser Devis Express Pro sans interruption.
        </p>
        ${btn(ctx.baseUrl, 'Choisir mon plan')}
    `);
}

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