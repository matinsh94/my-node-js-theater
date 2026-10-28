// Reservation logic: direct seat selection, automatic seat assignment,
// modifying and deleting reservations, and the 40-second release restriction.
// Every mutation runs inside a SQLite transaction and re-validates seat
// availability inside that transaction, so concurrent requests can never
// double-book a seat (the UNIQUE(seat_id) constraint is the final guarantee).
import express from 'express';
import {
  ApiError,
  wrap,
  requireAuth,
  requireObject,
  parseId,
  parseSeatIdArray,
  parseCategory,
  parseCount,
} from './middleware.mjs';
import {
  SEAT_COOLDOWN_MS,
  getSeatsByIds,
  seatIdsOfReservation,
  getActiveRelease,
  recordReleases,
} from './db.mjs';

function seatLabel(seat) {
  return `seat ${seat.row}${seat.number}`;
}

// Throws a descriptive ApiError if any seat is reserved by anyone, missing,
// or still inside the caller's 40-second release cooldown.
export function assertSeatsFreeForUser(db, userId, seatIds, now) {
  const placeholders = seatIds.map(() => '?').join(', ');
  const seats = db
    .prepare(
      `SELECT s.id, s.row, s.number, rs.seat_id AS taken
         FROM seats s
         LEFT JOIN reservation_seats rs ON rs.seat_id = s.id
        WHERE s.id IN (${placeholders})`
    )
    .all(...seatIds);
  const foundIds = new Set(seats.map((seat) => seat.id));
  for (const seatId of seatIds) {
    if (!foundIds.has(seatId)) {
      throw new ApiError(400, `Seat id ${seatId} does not exist.`, 'invalid_input');
    }
  }
  for (const seat of seats) {
    if (seat.taken !== null) {
      throw new ApiError(409, `${seatLabel(seat)} is already reserved.`, 'seat_reserved');
    }
    const release = getActiveRelease(db, userId, seat.id, now);
    if (release) {
      const secondsLeft = Math.max(1, Math.ceil((release.released_at + SEAT_COOLDOWN_MS - now) / 1000));
      throw new ApiError(
        409,
        `${seatLabel(seat)} was just released by you; you can reserve it again in ${secondsLeft}s.`,
        'seat_cooldown'
      );
    }
  }
}

// Automatic assignment, documented selection rule:
// 1. Consider available seats of the requested category that are not in the
//    requesting user's release cooldown.
// 2. If some single row has enough available seats, pick the row with the
//    FEWEST available seats that still fits (best fit, keeps big blocks open),
//    breaking ties by alphabetically first row. Within the row take the
//    lowest seat numbers.
// 3. Otherwise combine seats across rows in (row, number) order.
// 4. Never create a partial reservation.
function pickAutoAssignedSeats(db, userId, count, category, now) {
  const seats = db
    .prepare(
      `SELECT s.id, s.row, s.number, s.category
         FROM seats s
         LEFT JOIN reservation_seats rs ON rs.seat_id = s.id
        WHERE s.category = ? AND rs.seat_id IS NULL
        ORDER BY s.row, s.number`
    )
    .all(category);

  const eligible = seats.filter((seat) => !getActiveRelease(db, userId, seat.id, now));
  if (eligible.length < count) {
    throw new ApiError(
      422,
      `Not enough available seats in the '${category}' category (requested ${count}, available ${eligible.length}).`,
      'insufficient_seats'
    );
  }

  const byRow = new Map();
  for (const seat of eligible) {
    if (!byRow.has(seat.row)) byRow.set(seat.row, []);
    byRow.get(seat.row).push(seat);
  }
  const fittingRows = [...byRow.entries()]
    .filter(([, rowSeats]) => rowSeats.length >= count)
    .sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1));

  if (fittingRows.length > 0) {
    return { seats: fittingRows[0][1].slice(0, count), strategy: 'single-row' };
  }
  return { seats: eligible.slice(0, count), strategy: 'cross-row' };
}

function reservationToJson(db, reservation) {
  const seats = getSeatsByIds(db, seatIdsOfReservation(db, reservation.id));
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

export function createReservationsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  const insertReservation = db.prepare(
    'INSERT INTO reservations (user_id, created_at, updated_at) VALUES (?, ?, ?)'
  );
  const insertReservationSeat = db.prepare(
    'INSERT INTO reservation_seats (reservation_id, seat_id, added_at) VALUES (?, ?, ?)'
  );
  const touchReservation = db.prepare('UPDATE reservations SET updated_at = ? WHERE id = ?');

  // Runs fn inside a transaction. better-sqlite3 transactions are synchronous
  // and serialized on one connection, so check-then-write stays atomic.
  const inTransaction = db.transaction((fn) => fn());

  // GET /api/reservations — the current user's own reservations.
  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM reservations WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id);
    res.json({ success: true, data: { reservations: rows.map((r) => reservationToJson(db, r)) } });
  });

  // GET /api/reservations/:id — one of the current user's own reservations.
  router.get(
    '/:reservationId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const reservation = getReservationOr404(db, reservationId);
      if (reservation.user_id !== req.user.id) {
        throw new ApiError(403, 'You can only view your own reservations.', 'forbidden');
      }
      res.json({ success: true, data: { reservation: reservationToJson(db, reservation) } });
    })
  );

  // POST /api/reservations — create a reservation from directly selected seats.
  router.post(
    '/',
    wrap(async (req, res) => {
      requireObject(req.body);
      const seatIds = [...new Set(parseSeatIdArray(req.body.seatIds))];
      const result = inTransaction(() => {
        const now = Date.now();
        assertSeatsFreeForUser(db, req.user.id, seatIds, now);
        const { lastInsertRowid: reservationId } = insertReservation.run(req.user.id, now, now);
        for (const seatId of seatIds) insertReservationSeat.run(reservationId, seatId, now);
        return reservationId;
      });
      const reservation = getReservationOr404(db, result);
      res.status(201).json({ success: true, data: { reservation: reservationToJson(db, reservation) } });
    })
  );

  // POST /api/reservations/auto — create a reservation with automatic assignment.
  router.post(
    '/auto',
    wrap(async (req, res) => {
      requireObject(req.body);
      const count = parseCount(req.body.count);
      const category = parseCategory(req.body.category);
      const { reservationId, strategy } = inTransaction(() => {
        const now = Date.now();
        const { seats, strategy } = pickAutoAssignedSeats(db, req.user.id, count, category, now);
        const { lastInsertRowid: id } = insertReservation.run(req.user.id, now, now);
        for (const seat of seats) insertReservationSeat.run(id, seat.id, now);
        return { reservationId: id, strategy };
      });
      const reservation = getReservationOr404(db, reservationId);
      res.status(201).json({
        success: true,
        data: { reservation: reservationToJson(db, reservation), strategy },
      });
    })
  );

  // POST /api/reservations/:id/seats — add seats to an existing reservation.
  router.post(
    '/:reservationId/seats',
    wrap(async (req, res) => {
      requireObject(req.body);
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const seatIds = [...new Set(parseSeatIdArray(req.body.seatIds))];
      const reservation = inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        if (target.user_id !== req.user.id) {
          throw new ApiError(403, 'You can only modify your own reservations.', 'forbidden');
        }
        const now = Date.now();
        assertSeatsFreeForUser(db, req.user.id, seatIds, now);
        for (const seatId of seatIds) insertReservationSeat.run(reservationId, seatId, now);
        touchReservation.run(now, reservationId);
        return target;
      });
      res.json({
        success: true,
        data: { reservation: reservationToJson(db, reservation) },
      });
    })
  );

  // DELETE /api/reservations/:id/seats/:seatId — remove one seat; the release
  // is recorded so the same user must wait 40 seconds before re-booking it.
  router.delete(
    '/:reservationId/seats/:seatId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      const seatId = parseId(req.params.seatId, 'seat id');
      const reservation = inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        if (target.user_id !== req.user.id) {
          throw new ApiError(403, 'You can only modify your own reservations.', 'forbidden');
        }
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

  // DELETE /api/reservations/:id — delete the whole reservation; every seat
  // release is recorded (and the history survives the deletion).
  router.delete(
    '/:reservationId',
    wrap(async (req, res) => {
      const reservationId = parseId(req.params.reservationId, 'reservation id');
      inTransaction(() => {
        const target = getReservationOr404(db, reservationId);
        if (target.user_id !== req.user.id) {
          throw new ApiError(403, 'You can only delete your own reservations.', 'forbidden');
        }
        recordReleases(db, target.user_id, seatIdsOfReservation(db, reservationId), Date.now());
        db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
      });
      res.json({ success: true, data: { message: 'Reservation deleted.' } });
    })
  );

  return router;
}

// "I can't go back to yesterday because I was a different person then." — Alice in Wonderland
