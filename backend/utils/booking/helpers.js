// backend/utils/booking/helpers.js
// Logique metier des rendez-vous

const crypto = require('crypto');
const { pool } = require('../../db');

const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ------------------------------------------------------------
// Genere un slug a partir d'un nom (pour l'URL publique)
// ------------------------------------------------------------
function slugify(str) {
    if (!str) return null;
    return String(str)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

// ------------------------------------------------------------
// Charge la config booking d'un utilisateur
// ------------------------------------------------------------
async function getUserBookingConfig(userId) {
    const result = await pool.query(
        'SELECT booking_enabled, booking_slug, booking_duration, booking_buffer_minutes, booking_days_ahead, booking_notify_email, booking_notify_sms, booking_message, company_name FROM settings WHERE user_id = $1',
        [userId]
    );

    if (result.rows.length === 0) return null;

    const s = result.rows[0];

    return {
        enabled: s.booking_enabled || false,
        slug: s.booking_slug,
        duration: parseInt(s.booking_duration) || 60,
        bufferMinutes: parseInt(s.booking_buffer_minutes) || 15,
        daysAhead: parseInt(s.booking_days_ahead) || 60,
        notifyEmail: s.booking_notify_email !== false,
        notifySms: s.booking_notify_sms === true,
        message: s.booking_message,
        companyName: s.company_name
    };
}

// ------------------------------------------------------------
// Charge les disponibilites d'un utilisateur
// ------------------------------------------------------------
async function getUserAvailability(userId) {
    const result = await pool.query(
        'SELECT * FROM availability_slots WHERE user_id = $1 AND active = TRUE ORDER BY weekday, start_time',
        [userId]
    );

    return result.rows.map(s => ({
        id: s.id,
        weekday: s.weekday,
        startTime: s.start_time,
        endTime: s.end_time
    }));
}

// ------------------------------------------------------------
// Charge les periodes d'indisponibilite a venir
// ------------------------------------------------------------
async function getUserUnavailablePeriods(userId, fromDate, toDate) {
    const result = await pool.query(`
        SELECT * FROM unavailable_periods
        WHERE user_id = $1
          AND end_date >= $2
          AND start_date <= $3
        ORDER BY start_date ASC
    `, [userId, fromDate, toDate]);

    return result.rows.map(p => ({
        id: p.id,
        startDate: p.start_date,
        endDate: p.end_date,
        reason: p.reason
    }));
}

// ------------------------------------------------------------
// Genere les creneaux disponibles pour une date donnee
// ------------------------------------------------------------
function generateSlotsForDay(date, weekday, availabilities, appointments, bufferMinutes) {
    // Availabilities = plages de travail pour ce jour de la semaine
    const daySlots = availabilities.filter(a => a.weekday === weekday);

    if (daySlots.length === 0) return [];

    // Appointments de cette date (pour bloquer les creneaux deja pris)
    const takenRanges = appointments.map(a => {
        // Convertir en minutes depuis minuit
        const [startH, startM] = a.start_time.split(':').map(Number);
        const [endH, endM] = a.end_time.split(':').map(Number);
        return {
            startMin: startH * 60 + startM,
            endMin: endH * 60 + endM
        };
    });

    const slots = [];

    for (const slot of daySlots) {
        const [startH, startM] = slot.startTime.split(':').map(Number);
        const [endH, endM] = slot.endTime.split(':').map(Number);

        const slotStartMin = startH * 60 + startM;
        const slotEndMin = endH * 60 + endM;

        // Decouper en creneaux de 30 minutes
        let current = slotStartMin;

        while (current + 30 <= slotEndMin) {
            // Verifier si le creneau n'est pas dans un rendez-vous
            const slotEnd = current + 30;
            const isTaken = takenRanges.some(r =>
                (current >= r.startMin - bufferMinutes && current < r.endMin + bufferMinutes) ||
                (slotEnd > r.startMin - bufferMinutes && slotEnd <= r.endMin + bufferMinutes) ||
                (current <= r.startMin && slotEnd >= r.endMin)
            );

            if (!isTaken) {
                slots.push({
                    start: String(Math.floor(current / 60)).padStart(2, '0') + ':' + String(current % 60).padStart(2, '0'),
                    end: String(Math.floor(slotEnd / 60)).padStart(2, '0') + ':' + String(slotEnd % 60).padStart(2, '0'),
                    startMin: current
                });
            }

            current += 30;
        }
    }

    return slots;
}

// ------------------------------------------------------------
// Charge tous les creneaux disponibles pour une plage de dates
// ------------------------------------------------------------
async function getAvailableSlots(userId, daysAhead) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    const availabilities = await getUserAvailability(userId);
    const unavailablePeriods = await getUserUnavailablePeriods(
        userId,
        today.toISOString().slice(0, 10),
        endDate.toISOString().slice(0, 10)
    );

    const appointmentsResult = await pool.query(`
        SELECT appointment_date, start_time, end_time FROM appointments
        WHERE user_id = $1
          AND appointment_date >= $2
          AND appointment_date <= $3
          AND status IN ('pending', 'confirmed')
    `, [userId, today.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)]);

    const appointmentsByDate = {};
    for (const a of appointmentsResult.rows) {
        const key = new Date(a.appointment_date).toISOString().slice(0, 10);
        if (!appointmentsByDate[key]) appointmentsByDate[key] = [];
        appointmentsByDate[key].push(a);
    }

    const result = [];
    const buffer = 15; // 15 minutes de battement entre 2 rdv par defaut

    for (let i = 0; i < daysAhead; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().slice(0, 10);
        const weekday = date.getDay();

        // Verifier si la date est dans une periode d'indisponibilite
        const isUnavailable = unavailablePeriods.some(p => {
            const pStart = new Date(p.startDate).toISOString().slice(0, 10);
            const pEnd = new Date(p.endDate).toISOString().slice(0, 10);
            return dateStr >= pStart && dateStr <= pEnd;
        });

        if (isUnavailable) {
            result.push({ date: dateStr, weekday: WEEKDAYS_FR[weekday], slots: [], unavailable: true });
            continue;
        }

        const slots = generateSlotsForDay(
            date,
            weekday,
            availabilities,
            appointmentsByDate[dateStr] || [],
            buffer
        );

        result.push({
            date: dateStr,
            weekday: WEEKDAYS_FR[weekday],
            slots: slots,
            unavailable: false
        });
    }

    return result;
}

// ------------------------------------------------------------
// Verifie qu'un creneau est bien disponible
// ------------------------------------------------------------
async function isSlotAvailable(userId, date, startTime) {
    // Calculer la fin
    const [h, m] = startTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + 30;
    const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

    // Verifier qu'il n'y a pas de conflit
    const conflictResult = await pool.query(`
        SELECT id FROM appointments
        WHERE user_id = $1
          AND appointment_date = $2
          AND status IN ('pending', 'confirmed')
          AND (
              (start_time < $4 AND end_time > $3)
              OR (start_time >= $3 AND start_time < $4)
              OR (end_time > $3 AND end_time <= $4)
          )
    `, [userId, date, startTime, endTime]);

    return conflictResult.rows.length === 0;
}

// ------------------------------------------------------------
// Cree un rendez-vous
// ------------------------------------------------------------
async function createAppointment(userId, data) {
    const { clientName, clientEmail, clientPhone, clientAddress, subject, notes, date, startTime, durationMinutes, source } = data;

    if (!clientName || !date || !startTime) {
        throw new Error('Nom, date et heure de debut sont requis.');
    }

    // Verifier disponibilite
    const available = await isSlotAvailable(userId, date, startTime);
    if (!available) {
        throw new Error('Ce creneau est deja pris.');
    }

    const duration = parseInt(durationMinutes) || 60;
    const [h, m] = startTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + duration;
    const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

    const result = await pool.query(`
        INSERT INTO appointments (
            user_id, client_name, client_email, client_phone, client_address,
            subject, notes, appointment_date, start_time, end_time,
            duration_minutes, status, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
    `, [
        userId,
        clientName.trim(),
        clientEmail || null,
        clientPhone || null,
        clientAddress || null,
        subject || null,
        notes || null,
        date,
        startTime,
        endTime,
        duration,
        source === 'public' ? 'pending' : 'confirmed',
        source || 'manual'
    ]);

    return result.rows[0];
}

// ------------------------------------------------------------
// Change le statut d'un rendez-vous
// ------------------------------------------------------------
async function updateAppointmentStatus(userId, appointmentId, newStatus, reason) {
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(newStatus)) {
        throw new Error('Statut invalide.');
    }

    const result = await pool.query(`
        UPDATE appointments
        SET status = $1,
            cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END,
            cancellation_reason = CASE WHEN $1 = 'cancelled' THEN $2 ELSE cancellation_reason END,
            updated_at = NOW()
        WHERE id = $3 AND user_id = $4
        RETURNING *
    `, [newStatus, reason || null, appointmentId, userId]);

    if (result.rows.length === 0) {
        throw new Error('Rendez-vous introuvable.');
    }

    return result.rows[0];
}

// ------------------------------------------------------------
// Charge la liste des rendez-vous
// ------------------------------------------------------------
async function getAppointments(userId, options = {}) {
    const { from, to, status, upcoming } = options;

    let query = 'SELECT * FROM appointments WHERE user_id = $1';
    const params = [userId];

    if (from) {
        params.push(from);
        query += ' AND appointment_date >= $' + params.length;
    }
    if (to) {
        params.push(to);
        query += ' AND appointment_date <= $' + params.length;
    }
    if (status) {
        params.push(status);
        query += ' AND status = $' + params.length;
    }
    if (upcoming) {
        query += ' AND appointment_date >= CURRENT_DATE';
    }

    query += ' ORDER BY appointment_date ASC, start_time ASC LIMIT 500';

    const result = await pool.query(query, params);

    return result.rows.map(a => ({
        id: a.id,
        clientName: a.client_name,
        clientEmail: a.client_email,
        clientPhone: a.client_phone,
        clientAddress: a.client_address,
        subject: a.subject,
        notes: a.notes,
        date: a.appointment_date,
        startTime: a.start_time,
        endTime: a.end_time,
        durationMinutes: a.duration_minutes,
        status: a.status,
        source: a.source,
        createdAt: a.created_at
    }));
}

// ------------------------------------------------------------
// Charge les disponibilites de facon structuree (pour la config)
// ------------------------------------------------------------
async function getAvailabilityGrouped(userId) {
    const result = await pool.query(
        'SELECT * FROM availability_slots WHERE user_id = $1 AND active = TRUE ORDER BY weekday, start_time',
        [userId]
    );

    const grouped = {};
    for (let i = 0; i < 7; i++) grouped[i] = [];

    for (const row of result.rows) {
        grouped[row.weekday].push({
            id: row.id,
            startTime: row.start_time,
            endTime: row.end_time
        });
    }

    return grouped;
}

module.exports = {
    WEEKDAYS_FR,
    slugify,
    getUserBookingConfig,
    getUserAvailability,
    getUserUnavailablePeriods,
    getAvailableSlots,
    isSlotAvailable,
    createAppointment,
    updateAppointmentStatus,
    getAppointments,
    getAvailabilityGrouped
};