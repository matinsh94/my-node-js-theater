// Admin API: inspect, modify and delete any user's reservation.
// Admins can never create a reservation on behalf of another user — that
// operation simply does not exist in the API surface.
import express from 'express';
import {
  ApiError,
  wrap,
  requireAdmin,
  requireObject,
  parseId,
  parseSeatIdArray,
} from './middleware.mjs';
import { seatIdsOfReservation, recordReleases } from './db.mjs';
import { assertSeatsFreeForUser } from './reservations.mjs';

function getReservationOr404(db, reservationId) {
  const reservation = db
    .prepare(
      `SELECT r.*, u.username FROM reservations r
         JOIN users u ON u.id = r.user_id
        WHERE r.id = ?`
    )
    .get(reservationId);
  if (!reservation) {
    throw new ApiError(404, 'Reservation not found.', 'not_found');
  }
  return reservation;
}

function reservationToJson(db, reservation) {
  const placeholders = seatIdsOfReservation(db, reservation.id)
    .map(() => '?')
    .join(', ');
  const seats = placeholders
    ? db.prepare(`SELECT id, row, number, category FROM seats WHERE id IN (${placeholders})`).all(
        ...seatIdsOfReservation(db, reservation.id)
      )
    : [];
  seats.sort((a, b) => (a.row === b.row ? a.number - b.number : a.row < b.row ? -1 : 1));
  return {
    id: reservation.id,
    userId: reservation.user_id,
    username: reservation.username,
    createdAt: reservation.created_at,
    updatedAt: reservation.updated_at,
    seats,
  };
}

export function createAdminRouter(db) {
  const router = express.Router();
  router.use(requireAdmin);

  const inTransaction = db.transaction((fn) => fn());
  const insertReservationSeat = db.prepare(
    'INSERT INTO reservation_seats (reservation_id, seat_id, added_at) VALUES (?, ?, ?)'
  );
  const touchReservation = db.prepare('UPDATE reservations SET updated_at = ? WHERE id = ?');

  // GET /api/admin/users — all accounts (for the admin dashboard).
  router.get('/users', (req, res) => {
    const users = db
      .prepare('SELECT id, username, is_admin FROM users ORDER BY id')
      .all()
      .map((user) => ({ id: user.id, username: user.username, isAdmin: user.is_admin === 1 }));
    res.json({ success: true, data: { users } });
  });

  // GET /api/admin/reservations — every reservation with its owner.
  router.get('/reservations', (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, u.username FROM reservations r
           JOIN users u ON u.id = r.user_id
          ORDER BY r.created_at DESC`
      )
      .all();
    res.json({ success: true, data: { reservations: rows.map((r) => reservationToJson(db, r)) } });
  });

  // GET /api/admin/reservations/:id — inspect any reservation.
  router.get(
    '/reservations/:reservationId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const reservation = getReservationOr404(db, reservationId);
      res.json({ success: true, data: { reservation: reservationToJson(db, reservation) } });
    })
  );

  // POST /api/admin/reservations/:id/seats — add seats to any reservation.
  // Availability and the 40-second rule are checked against the OWNER's
  // release history, because the seats end up in the owner's reservation.
  router.post(
    '/reservations/:reservationId/seats',
    wrap(async (req, res) => {
      requireObject(req.body);
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const seatIds = [...new Set(parseSeatIdArray(req.body.seatIds))];
      const reservation = inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        const now = Date.now();
        assertSeatsFreeForUser(db, target.user_id, seatIds, now);
        for (const seatId of seatIds) insertReservationSeat.run(reservationId, seatId, now);
        touchReservation.run(now, reservationId);
        return target;
      });
      res.json({ success: true, data: { reservation: reservationToJson(db, reservation) } });
    })
  );

  // DELETE /api/admin/reservations/:id/seats/:seatId — remove a seat from any
  // reservation; the release is recorded for the owner.
  router.delete(
    '/reservations/:reservationId/seats/:seatId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const seatId = parseId(req.params.seatId, 'seat id');
      const reservation = inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        const member = db
          .prepare('SELECT 1 FROM reservation_seats WHERE reservation_id = ? AND seat_id = ?')
          .get(reservationId, seatId);
        if (!member) {
          throw new ApiError(404, 'That seat is not part of this reservation.', 'not_found');
        }
        const now = Date.now();
        db.prepare('DELETE FROM reservation_seats WHERE reservation_id = ? AND seat_id = ?').run(
          reservationId,
          seatId
        );
        recordReleases(db, target.user_id, [seatId], now);
        touchReservation.run(now, reservationId);
        return target;
      });
      res.json({ success: true, data: { reservation: reservationToJson(db, reservation) } });
    })
  );

  // DELETE /api/admin/reservations/:id — delete any user's reservation;
  // every seat release is recorded for the owner.
  router.delete(
    '/reservations/:reservationId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        recordReleases(db, target.user_id, seatIdsOfReservation(db, reservationId), Date.now());
        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
      });
      res.json({ success: true, data: { message: 'Reservation deleted.' } });
    })
  );

  return router;
}

// "Off with their heads!" — the Queen of Hearts, Alice in Wonderland
