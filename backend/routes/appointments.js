// backend/routes/appointments.js
// Routes pour la prise de rendez-vous

const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
    WEEKDAYS_FR,
    slugify,
    getUserBookingConfig,
    getAvailableSlots,
    isSlotAvailable,
    createAppointment,
    updateAppointmentStatus,
    getAppointments,
    getAvailabilityGrouped
} = require('../utils/booking/helpers');
const { Resend } = require('resend');

const router = express.Router();

// ============================================================
// GET /api/appointments/config — Configuration booking
// ============================================================
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT booking_enabled, booking_slug, booking_duration, booking_buffer_minutes,
                   booking_days_ahead, booking_notify_email, booking_notify_sms, booking_message
            FROM settings WHERE user_id = $1
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                slug: '',
                duration: 60,
                bufferMinutes: 15,
                daysAhead: 60,
                notifyEmail: true,
                notifySms: false,
                message: ''
            });
        }

        const s = result.rows[0];
        res.json({
            enabled: s.booking_enabled || false,
            slug: s.booking_slug || '',
            duration: parseInt(s.booking_duration) || 60,
            bufferMinutes: parseInt(s.booking_buffer_minutes) || 15,
            daysAhead: parseInt(s.booking_days_ahead) || 60,
            notifyEmail: s.booking_notify_email !== false,
            notifySms: s.booking_notify_sms === true,
            message: s.booking_message || ''
        });
    } catch (err) {
        console.error('Erreur get booking config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/appointments/config — Sauvegarder la config
// ============================================================
router.post('/config', authenticateToken, async (req, res) => {
    const { enabled, slug, duration, bufferMinutes, daysAhead, notifyEmail, notifySms, message } = req.body;

    try {
        // Verifier unicite du slug
        if (slug && slug.trim()) {
            const slugClean = slugify(slug);
            if (!slugClean) {
                return res.status(400).json({ error: 'Slug invalide.' });
            }

            const existing = await pool.query(
                'SELECT user_id FROM settings WHERE booking_slug = $1 AND user_id != $2',
                [slugClean, req.user.id]
            );

            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Ce slug est deja utilise par un autre compte.' });
            }
        }

        await pool.query(
            'INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );

        const updates = [];
        const params = [req.user.id];
        let idx = 2;

        if (enabled !== undefined) {
            updates.push('booking_enabled = $' + idx);
            params.push(enabled === true);
            idx++;
        }
        if (slug !== undefined) {
            updates.push('booking_slug = $' + idx);
            params.push(slug && slug.trim() ? slugify(slug) : null);
            idx++;
        }
        if (duration !== undefined) {
            updates.push('booking_duration = $' + idx);
            params.push(Math.max(15, Math.min(parseInt(duration) || 60, 480)));
            idx++;
        }
        if (bufferMinutes !== undefined) {
            updates.push('booking_buffer_minutes = $' + idx);
            params.push(Math.max(0, Math.min(parseInt(bufferMinutes) || 15, 120)));
            idx++;
        }
        if (daysAhead !== undefined) {
            updates.push('booking_days_ahead = $' + idx);
            params.push(Math.max(7, Math.min(parseInt(daysAhead) || 60, 365)));
            idx++;
        }
        if (notifyEmail !== undefined) {
            updates.push('booking_notify_email = $' + idx);
            params.push(notifyEmail === true);
            idx++;
        }
        if (notifySms !== undefined) {
            updates.push('booking_notify_sms = $' + idx);
            params.push(notifySms === true);
            idx++;
        }
        if (message !== undefined) {
            updates.push('booking_message = $' + idx);
            params.push(message || null);
            idx++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune modification.' });
        }

        updates.push('updated_at = NOW()');

        await pool.query(
            'UPDATE settings SET ' + updates.join(', ') + ' WHERE user_id = $1',
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Erreur save booking config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/appointments/availability — Plages de disponibilite
// ============================================================
router.get('/availability', authenticateToken, async (req, res) => {
    try {
        const grouped = await getAvailabilityGrouped(req.user.id);
        res.json({ weekdays: WEEKDAYS_FR, slots: grouped });
    } catch (err) {
        console.error('Erreur get availability:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/appointments/availability — Ajouter une plage
// ============================================================
router.post('/availability', authenticateToken, async (req, res) => {
    const { weekday, startTime, endTime } = req.body;

    if (weekday === undefined || !startTime || !endTime) {
        return res.status(400).json({ error: 'Jour, heure de debut et heure de fin requis.' });
    }

    const wd = parseInt(weekday);
    if (wd < 0 || wd > 6) {
        return res.status(400).json({ error: 'Jour invalide.' });
    }
    if (startTime >= endTime) {
        return res.status(400).json({ error: 'L\'heure de fin doit etre apres l\'heure de debut.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO availability_slots (user_id, weekday, start_time, end_time)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [req.user.id, wd, startTime, endTime]);

        res.json({ success: true, slot: result.rows[0] });
    } catch (err) {
        console.error('Erreur add availability:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/appointments/availability/:id — Supprimer une plage
// ============================================================
router.delete('/availability/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM availability_slots WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Plage introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/appointments/unavailable — Periodes d'indisponibilite
// ============================================================
router.get('/unavailable', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM unavailable_periods
            WHERE user_id = $1 AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
        `, [req.user.id]);

        res.json(result.rows.map(p => ({
            id: p.id,
            startDate: p.start_date,
            endDate: p.end_date,
            reason: p.reason
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/appointments/unavailable — Ajouter une periode
// ============================================================
router.post('/unavailable', authenticateToken, async (req, res) => {
    const { startDate, endDate, reason } = req.body;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Dates de debut et fin requises.' });
    }
    if (startDate > endDate) {
        return res.status(400).json({ error: 'La date de fin doit etre apres la date de debut.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO unavailable_periods (user_id, start_date, end_date, reason)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [req.user.id, startDate, endDate, reason || null]);

        res.json({ success: true, period: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/appointments/unavailable/:id — Supprimer une periode
// ============================================================
router.delete('/unavailable/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM unavailable_periods WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Periode introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET /api/appointments — Liste des rendez-vous
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { from, to, status, upcoming } = req.query;

        const appointments = await getAppointments(req.user.id, {
            from,
            to,
            status,
            upcoming: upcoming === 'true'
        });

        res.json(appointments);
    } catch (err) {
        console.error('Erreur list appointments:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// POST /api/appointments — Creer un rendez-vous (cote proprietaire)
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const {
        clientName, clientEmail, clientPhone, clientAddress,
        subject, notes, date, startTime, durationMinutes
    } = req.body;

    if (!clientName || !date || !startTime) {
        return res.status(400).json({ error: 'Nom, date et heure de debut requis.' });
    }

    try {
        const appointment = await createAppointment(req.user.id, {
            clientName,
            clientEmail,
            clientPhone,
            clientAddress,
            subject,
            notes,
            date,
            startTime,
            durationMinutes,
            source: 'manual'
        });

        res.json({ success: true, appointment });
    } catch (err) {
        console.error('Erreur create appointment:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// PUT /api/appointments/:id/status — Changer le statut
// ============================================================
router.put('/:id/status', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    const { status, reason } = req.body;

    try {
        const appointment = await updateAppointmentStatus(req.user.id, id, status, reason);
        res.json({ success: true, appointment });
    } catch (err) {
        console.error('Erreur update status:', err);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// DELETE /api/appointments/:id — Supprimer un rendez-vous
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide.' });

    try {
        const result = await pool.query(
            'DELETE FROM appointments WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Rendez-vous introuvable.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PARTIE PUBLIQUE (sans authentification)
// ============================================================

// ------------------------------------------------------------
// GET /api/appointments/public/config/:identifier
// identifier = ID utilisateur ou slug
// ------------------------------------------------------------
router.get('/public/config/:identifier', async (req, res) => {
    const { identifier } = req.params;

    try {
        // Chercher par slug d'abord, sinon par id
        let result = await pool.query(`
            SELECT s.user_id, s.booking_enabled, s.booking_duration, s.booking_days_ahead,
                   s.booking_message, s.company_name, s.address, s.phone, s.email, s.logo
            FROM settings s
            WHERE s.booking_slug = $1 AND s.booking_enabled = TRUE
        `, [identifier]);

        if (result.rows.length === 0) {
            // Essayer par id
            const id = parseInt(identifier);
            if (!isNaN(id)) {
                result = await pool.query(`
                    SELECT s.user_id, s.booking_enabled, s.booking_duration, s.booking_days_ahead,
                           s.booking_message, s.company_name, s.address, s.phone, s.email, s.logo
                    FROM settings s
                    WHERE s.user_id = $1 AND s.booking_enabled = TRUE
                `, [id]);
            }
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Page de reservation introuvable ou desactivee.' });
        }

        const s = result.rows[0];

        res.json({
            userId: s.user_id,
            companyName: s.company_name,
            address: s.address,
            phone: s.phone,
            email: s.email,
            logo: s.logo,
            duration: parseInt(s.booking_duration) || 60,
            daysAhead: parseInt(s.booking_days_ahead) || 60,
            message: s.booking_message
        });
    } catch (err) {
        console.error('Erreur public config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// GET /api/appointments/public/slots/:identifier
// ------------------------------------------------------------
router.get('/public/slots/:identifier', async (req, res) => {
    const { identifier } = req.params;

    try {
        // Trouver l'utilisateur
        let userResult = await pool.query(
            'SELECT user_id, booking_days_ahead FROM settings WHERE booking_slug = $1 AND booking_enabled = TRUE',
            [identifier]
        );

        if (userResult.rows.length === 0) {
            const id = parseInt(identifier);
            if (!isNaN(id)) {
                userResult = await pool.query(
                    'SELECT user_id, booking_days_ahead FROM settings WHERE user_id = $1 AND booking_enabled = TRUE',
                    [id]
                );
            }
        }

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Page introuvable.' });
        }

        const userId = userResult.rows[0].user_id;
        const daysAhead = parseInt(userResult.rows[0].booking_days_ahead) || 60;

        const slots = await getAvailableSlots(userId, daysAhead);
        res.json(slots);
    } catch (err) {
        console.error('Erreur public slots:', err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------
// POST /api/appointments/public/book/:identifier
// ------------------------------------------------------------
router.post('/public/book/:identifier', async (req, res) => {
    const { identifier } = req.params;
    const { clientName, clientEmail, clientPhone, clientAddress, subject, notes, date, startTime } = req.body;

    if (!clientName || !date || !startTime) {
        return res.status(400).json({ error: 'Nom, date et heure requis.' });
    }
    if (!clientEmail && !clientPhone) {
        return res.status(400).json({ error: 'Email ou telephone requis pour vous recontacter.' });
    }

    try {
        // Trouver l'utilisateur
        let userResult = await pool.query(
            'SELECT user_id FROM settings WHERE booking_slug = $1 AND booking_enabled = TRUE',
            [identifier]
        );

        if (userResult.rows.length === 0) {
            const id = parseInt(identifier);
            if (!isNaN(id)) {
                userResult = await pool.query(
                    'SELECT user_id FROM settings WHERE user_id = $1 AND booking_enabled = TRUE',
                    [id]
                );
            }
        }

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Page introuvable.' });
        }

        const userId = userResult.rows[0].user_id;

        // Verifier que le creneau est toujours libre
        const available = await isSlotAvailable(userId, date, startTime);
        if (!available) {
            return res.status(400).json({ error: 'Ce creneau vient d\'etre reserve. Choisissez-en un autre.' });
        }

        // Recuperer la duree par defaut
        const settingsResult = await pool.query(
            'SELECT booking_duration, company_name, booking_notify_email, booking_notify_sms, phone FROM settings WHERE user_id = $1',
            [userId]
        );
        const s = settingsResult.rows[0] || {};
        const duration = parseInt(s.booking_duration) || 60;

        // Creer le rendez-vous
        const appointment = await createAppointment(userId, {
            clientName,
            clientEmail,
            clientPhone,
            clientAddress,
            subject,
            notes,
            date,
            startTime,
            durationMinutes: duration,
            source: 'public'
        });

        // Notification email au proprietaire
        if (s.booking_notify_email !== false && process.env.RESEND_API_KEY) {
            try {
                const ownerResult = await pool.query(
                    'SELECT email FROM users WHERE id = $1',
                    [userId]
                );
                const ownerEmail = ownerResult.rows[0]?.email;

                if (ownerEmail) {
                    const resend = new Resend(process.env.RESEND_API_KEY);
                    const companyName = s.company_name || 'Votre entreprise';

                    await resend.emails.send({
                        from: process.env.RESEND_FROM_EMAIL || 'Reservation <noreply@votreentreprise.com>',
                        to: [ownerEmail],
                        subject: 'Nouvelle demande de rendez-vous - ' + clientName,
                        html: `
                            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                <div style="background:#f97316;color:#fff;padding:20px;border-radius:10px;text-align:center;margin-bottom:20px;">
                                    <h1 style="margin:0;font-size:20px;">Nouvelle demande de rendez-vous</h1>
                                </div>
                                <p style="font-size:15px;line-height:1.6;"><strong>${clientName}</strong> a reserve un creneau.</p>
                                <div style="background:#f6f9fc;border-left:3px solid #f97316;padding:14px 18px;border-radius:8px;margin:20px 0;">
                                    <div style="font-size:14px;line-height:1.8;">
                                        <div><strong>Date :</strong> ${new Date(date).toLocaleDateString('fr-FR')}</div>
                                        <div><strong>Heure :</strong> ${startTime} (${duration} min)</div>
                                        ${clientEmail ? '<div><strong>Email :</strong> ' + clientEmail + '</div>' : ''}
                                        ${clientPhone ? '<div><strong>Telephone :</strong> ' + clientPhone + '</div>' : ''}
                                        ${subject ? '<div><strong>Motif :</strong> ' + subject + '</div>' : ''}
                                        ${notes ? '<div style="margin-top:8px;"><strong>Notes :</strong><br>' + notes + '</div>' : ''}
                                    </div>
                                </div>
                                <p style="font-size:13px;color:#64748b;">Connectez-vous a votre application pour confirmer ou annuler ce rendez-vous.</p>
                            </div>
                        `
                    });
                }
            } catch (emailErr) {
                console.warn('Erreur envoi email booking:', emailErr.message);
            }
        }

        // Email de confirmation au client
        if (clientEmail && process.env.RESEND_API_KEY) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const companyName = s.company_name || 'Notre entreprise';

                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL || 'Reservation <noreply@votreentreprise.com>',
                    to: [clientEmail],
                    subject: 'Votre demande de rendez-vous - ' + companyName,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <h1 style="color:#0b1120;font-size:22px;margin-bottom:16px;">Votre demande de rendez-vous</h1>
                            <p style="font-size:15px;line-height:1.6;">Bonjour ${clientName},</p>
                            <p style="font-size:15px;line-height:1.6;">
                                Nous avons bien recu votre demande de rendez-vous pour le <strong>${new Date(date).toLocaleDateString('fr-FR')}</strong> a <strong>${startTime}</strong>.
                            </p>
                            <p style="font-size:15px;line-height:1.6;">
                                Vous recevrez une confirmation de la part de ${companyName} dans les plus brefs delais.
                            </p>
                            <p style="font-size:13px;color:#64748b;">Cordialement,<br>${companyName}</p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.warn('Erreur email client:', emailErr.message);
            }
        }

        res.json({ success: true, appointmentId: appointment.id });
    } catch (err) {
        console.error('Erreur public book:', err);
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;