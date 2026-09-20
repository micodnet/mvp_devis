// backend/__tests__/auth-validation.test.js
// Tests de validation pour l'authentification

describe('Validation signup', () => {
    // Reproduction de la logique de validation du signup
    function validateSignup({ email, password, termsAccepted }) {
        if (!email || !password) return { ok: false, error: 'Email et mot de passe requis.' };
        if (password.length < 6) return { ok: false, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
        if (!termsAccepted) return { ok: false, error: 'Vous devez accepter les CGU et la politique de confidentialité.' };
        return { ok: true };
    }

    test('Refuse si email manquant', () => {
        const result = validateSignup({ email: '', password: 'test123', termsAccepted: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Email');
    });

    test('Refuse si mot de passe manquant', () => {
        const result = validateSignup({ email: 'test@test.com', password: '', termsAccepted: true });
        expect(result.ok).toBe(false);
    });

    test('Refuse mot de passe trop court', () => {
        const result = validateSignup({ email: 'test@test.com', password: '12345', termsAccepted: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('6 caractères');
    });

    test('Refuse si CGU non acceptées', () => {
        const result = validateSignup({ email: 'test@test.com', password: 'test123', termsAccepted: false });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('CGU');
    });

    test('Accepte un signup valide', () => {
        const result = validateSignup({ email: 'test@test.com', password: 'test123', termsAccepted: true });
        expect(result.ok).toBe(true);
    });

    test('Accepte un mot de passe de 6 caractères pile', () => {
        const result = validateSignup({ email: 'test@test.com', password: 'abc123', termsAccepted: true });
        expect(result.ok).toBe(true);
    });
});