const request = require('supertest');
const express = require('express');
const authRoutes = require('../routes/auth');

// Créer une mini-app pour tester
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth Routes', () => {
    test('POST /api/auth/signup refuse sans email', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ password: 'test123' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('POST /api/auth/signup refuse mot de passe trop court', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'test@test.com', password: '123' });
        expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/signup refuse sans acceptation CGU', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'test@test.com', password: 'test123' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('CGU');
    });
});