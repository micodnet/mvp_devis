// backend/utils/email-expiration.js
// ------------------------------------------------------------
// Détecte les devis qui expirent bientôt (J-3, J-1, J0)
// et envoie un email récapitulatif au propriétaire du compte
// ------------------------------------------------------------

const { Resend } = require('resend');
const { pool } = require('../db');
const { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } = require('./i18n');

// Paliers à vérifier : X jours avant expiration
const LEVELS = [3, 1, 0];

// Traductions des emails
const TEXTS = {
    fr: {
        subject: (n) => `⚠️ ${n} devis ${n > 1 ? 'expirent' : 'expire'} bientôt`,
        title: (n) => `⚠️ ${n} devis ${n > 1 ? 'expirent' : 'expire'} bientôt`,
        intro: "Voici les devis qui arrivent à échéance. Pensez à relancer vos clients.",
        expiring_today: "Expire aujourd'hui",
        expires_in: (d) => `Expire dans ${d} jour${d > 1 ? 's' : ''}`,
        total: "Montant",
        cta: "Voir mes devis",
        footer: "Devis Express Pro — Notifications automatiques"
    },
    nl: {
        subject: (n) => `⚠️ ${n} offerte${n > 1 ? 's' : ''} verloopt binnenkort`,
        title: (n) => `⚠️ ${n} offerte${n > 1 ? 's' : ''} verloopt binnenkort`,
        intro: "Hier zijn de offertes die binnenkort verlopen. Vergeet niet uw klanten op te volgen.",
        expiring_today: "Verloopt vandaag",
        expires_in: (d) => `Verloopt over ${d} dag${d > 1 ? 'en' : ''}`,
        total: "Bedrag",
        cta: "Mijn offertes bekijken",
        footer: "Devis Express Pro — Automatische meldingen"
    },
    en: {
        subject: (n) => `⚠️ ${n} quote${n > 1 ? 's' : ''} expiring soon`,
        title: (n) => `⚠️ ${n} quote${n > 1 ? 's' : ''} expiring soon`,
        intro: "Here are the quotes that are about to expire. Don't forget to follow up with your clients.",
        expiring_today: "Expires today",
        expires_in: (d) => `Expires in ${d} day${d > 1 ? 's' : ''}`,
        total: "Amount",
        cta: "View my quotes",
        footer: "Devis Express Pro — Automatic notifications"
    }
};

async function sendExpirationEmail(to, lang, quotes, baseUrl) {
    if (!process.env.RESEND_API_KEY) {
        console.warn(`RESEND_API_KEY absente — email non envoyé à ${to}`);
        return false;
    }
    const T = TEXTS[lang] || TEXTS.fr;

    // Construire les lignes du tableau
    const rowsHtml = quotes.map(q => {
        const levelText = q.daysLeft === 0 ? T.expiring_today : T.expires_in(q.daysLeft);
        const levelColor = q.daysLeft === 0 ? '#f87171' : (q.daysLeft === 1 ? '#f97316' : '#facc15');
        return `
            <tr>
                <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0b1120;">${q.quoteNumber}</td>
                <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;color:#334155;">${q.clientName || '—'}</td>
                <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;color:#334155;text-align:right;">${parseFloat(q.total).toFixed(2)} €</td>
                <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;font-weight:600;color:${levelColor};">${levelText}</td>
            </tr>
        `;
    }).join('');

    const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#0b1120;">
            <h1 style="color:#0b1120;font-size:24px;margin-bottom:16px;">${T.title(quotes.length)}</h1>
            <p style="font-size:15px;line-height:1.6;color:#334155;">${T.intro}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:20px;">
                <thead>
                    <tr style="background:#f8fafc;">
                        <th style="text-align:left;padding:10px 8px;color:#64748b;font-size:11px;text-transform:uppercase;">N°</th>
                        <th style="text-align:left;padding:10px 8px;color:#64748b;font-size:11px;text-transform:uppercase;">Client</th>
                        <th style="text-align:right;padding:10px 8px;color:#64748b;font-size:11px;text-transform:uppercase;">${T.total}</th>
                        <th style="text-align:left;padding:10px 8px;color:#64748b;font-size:11px;text-transform:uppercase;"></th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            <p style="text-align:center;margin:32px 0;">
                <a href="${baseUrl}" style="background:#f97316;color:#ffffff;padding:14px 32px;border-radius:60px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">${T.cta}</a>
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
            <p style="font-size:12px;color:#94a3b8;text-align:center;">${T.footer}</p>
        </div>
    `;

    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'Devis Express Pro <noreply@votreentreprise.com>',
            to: [to],
            subject: T.subject(quotes.length),
            html
        });
        if (error) {
            console.error(`Erreur email à ${to}:`, error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error(`Erreur email à ${to}:`, err.message);
        return false;
    }
}

// ------------------------------------------------------------
// Orchestrateur principal : à appeler via cron chaque jour
// ------------------------------------------------------------
async function runExpirationCheck(baseUrl = 'https://mvp-devis.onrender.com') {
    const stats = { emails_sent: 0, skipped: 0, quotes_notified: 0, details: [] };

    for (const daysLeft of LEVELS) {
        const level = `${daysLeft}d`;

        // Trouver les devis qui expirent dans exactement X jours
        // - status = 'sent' uniquement (draft pas encore envoyés, accepted/refused déjà réglés)
        // - pas encore notifiés pour ce palier
        const result = await pool.query(`
            SELECT q.id, q.user_id, q.quote_number, q.valid_date, q.total,
                   q.client_name, q.client_email,
                   u.email as owner_email,
                   COALESCE(s.language, 'fr') as language
            FROM quotes q
            JOIN users u ON u.id = q.user_id
            LEFT JOIN settings s ON s.user_id = q.user_id
            WHERE q.status = 'sent'
              AND q.valid_date = CURRENT_DATE + ($1 || ' days')::INTERVAL
              AND NOT EXISTS (
                  SELECT 1 FROM expiration_notifications en
                  WHERE en.quote_id = q.id AND en.level = $2
              )
            ORDER BY q.user_id
        `, [daysLeft, level]);

        // Grouper par utilisateur pour envoyer 1 email récap
        const byUser = {};
        for (const row of result.rows) {
            if (!byUser[row.user_id]) {
                byUser[row.user_id] = {
                    email: row.owner_email,
                    language: row.language,
                    quotes: []
                };
            }
            byUser[row.user_id].quotes.push({
                id: row.id,
                quoteNumber: row.quote_number,
                clientName: row.client_name,
                total: row.total,
                daysLeft
            });
        }

        // Envoyer les emails et logger
        for (const [userId, data] of Object.entries(byUser)) {
            const lang = SUPPORTED_LANGUAGES.includes(data.language) ? data.language : DEFAULT_LANGUAGE;
            const sent = await sendExpirationEmail(data.email, lang, data.quotes, baseUrl);

            if (sent) {
                // Marquer chaque devis comme notifié
                for (const q of data.quotes) {
                    try {
                        await pool.query(
                            'INSERT INTO expiration_notifications (user_id, quote_id, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                            [userId, q.id, level]
                        );
                    } catch (e) {
                        console.warn('Erreur insert notif:', e.message);
                    }
                }
                stats.emails_sent++;
                stats.quotes_notified += data.quotes.length;
                stats.details.push(`✅ J-${daysLeft} → ${data.email} (${data.quotes.length} devis)`);
            } else {
                stats.skipped++;
                stats.details.push(`❌ J-${daysLeft} → ${data.email} (échec)`);
            }
        }
    }

    return stats;
}

module.exports = { runExpirationCheck, LEVELS };