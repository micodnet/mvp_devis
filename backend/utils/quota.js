// Gère le quota mensuel de devis par utilisateur selon son plan

const { pool } = require('../db');

// Limites de devis par mois selon le plan
const PLAN_LIMITS = {
    free: 3,
    starter: 50,
    pro: 200,
    entreprise: Infinity, // illimité
};

function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

async function checkAndIncrementQuota(userId) {
    // 1. Récupérer le plan de l'utilisateur
    const userResult = await pool.query(
        'SELECT subscription_plan, subscription_status FROM users WHERE id = $1',
        [userId]
    );
    const user = userResult.rows[0];

    let plan = user.subscription_plan || 'free';
    // Si l'abonnement n'est pas actif, on retombe sur free
    if (plan !== 'free' && user.subscription_status !== 'active' && user.subscription_status !== 'trialing') {
        plan = 'free';
    }

    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const month = getCurrentMonth();

    // 2. Récupérer le compteur du mois
    const result = await pool.query(
        'SELECT quotes_count FROM monthly_quota WHERE user_id = $1 AND month = $2',
        [userId, month]
    );

    const currentCount = result.rows.length > 0 ? result.rows[0].quotes_count : 0;

    // 3. Vérifier la limite
    if (currentCount >= limit) {
        return {
            allowed: false,
            plan,
            limit,
            used: currentCount,
            message: `Vous avez atteint votre limite de ${limit} devis ce mois-ci. Passez à un plan supérieur pour continuer.`
        };
    }

    // 4. Incrémenter
    if (result.rows.length > 0) {
        await pool.query(
            'UPDATE monthly_quota SET quotes_count = quotes_count + 1 WHERE user_id = $1 AND month = $2',
            [userId, month]
        );
    } else {
        await pool.query(
            'INSERT INTO monthly_quota (user_id, month, quotes_count) VALUES ($1, $2, 1)',
            [userId, month]
        );
    }

    return {
        allowed: true,
        plan,
        limit: limit === Infinity ? 'illimité' : limit,
        used: currentCount + 1,
    };
}

module.exports = { checkAndIncrementQuota, PLAN_LIMITS };