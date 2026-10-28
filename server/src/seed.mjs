// Database seeding: runs automatically on server start, but only when the
// database is still empty, so restarts never duplicate data.
import bcrypt from 'bcryptjs';

// TOTP secret for the two admin-capable seeded accounts (per exam spec).
// Stored in a separate totp_secret column per user.
export const SEED_TOTP_SECRET = 'LXBSMDTMSP2I5XFXIYRGFVWSFI';

// The theater layout: first two rows are premium; rows have different lengths.
const THEATER_ROWS = [
  { row: 'A', seats: 12, category: 'premium' },
  { row: 'B', seats: 14, category: 'premium' },
  { row: 'C', seats: 20, category: 'normal' },
  { row: 'D', seats: 22, category: 'normal' },
  { row: 'E', seats: 18, category: 'normal' },
  { row: 'F', seats: 16, category: 'normal' },
];

// Exactly four users: two admin-capable (with TOTP), two regular.
const SEED_USERS = [
  { username: 'admin1', password: 'Admin1!Pass', is_admin: 1, totp_secret: SEED_TOTP_SECRET },
  { username: 'admin2', password: 'Admin2!Pass', is_admin: 1, totp_secret: SEED_TOTP_SECRET },
  { username: 'user1', password: 'User1!Pass', is_admin: 0, totp_secret: null },
  { username: 'user2', password: 'User2!Pass', is_admin: 0, totp_secret: null },
];

// Seeded reservations: four reservations held by exactly two users
// (one admin-capable user and one regular user).
const SEED_RESERVATIONS = [
  { username: 'admin1', seats: ['A1', 'A2', 'A3'] },
  { username: 'admin1', seats: ['C5', 'C6'] },
  { username: 'user1', seats: ['B8', 'B9', 'B10'] },
  { username: 'user1', seats: ['D10', 'D11', 'D12', 'D13'] },
];

export function seedDatabase(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const seatCount = db.prepare('SELECT COUNT(*) AS n FROM seats').get().n;
  if (userCount > 0 || seatCount > 0) return; // already seeded

  const seed = db.transaction(() => {
    const insertSeat = db.prepare(
      'INSERT INTO seats (row, number, category) VALUES (?, ?, ?)'
    );
    const seatIds = new Map(); // "A3" -> seat id
    for (const { row, seats, category } of THEATER_ROWS) {
      for (let number = 1; number <= seats; number += 1) {
        const info = insertSeat.run(row, number, category);
        seatIds.set(`${row}${number}`, info.lastInsertRowid);
      }
    }

    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, is_admin, totp_secret) VALUES (?, ?, ?, ?)'
    );
    const userIds = new Map();
    for (const user of SEED_USERS) {
      const passwordHash = bcrypt.hashSync(user.password, 10);
      const info = insertUser.run(user.username, passwordHash, user.is_admin, user.totp_secret);
      userIds.set(user.username, info.lastInsertRowid);
    }

    const insertReservation = db.prepare(
      'INSERT INTO reservations (user_id, created_at, updated_at) VALUES (?, ?, ?)'
    );
    const insertReservationSeat = db.prepare(
      'INSERT INTO reservation_seats (reservation_id, seat_id, added_at) VALUES (?, ?, ?)'
    );
    const now = Date.now();
    SEED_RESERVATIONS.forEach((reservation, index) => {
      const createdAt = now - (index + 1) * 3_600_000; // staggered "created" times
      const { lastInsertRowid: reservationId } = insertReservation.run(
        userIds.get(reservation.username),
        createdAt,
        createdAt
      );
      for (const seatLabel of reservation.seats) {
        insertReservationSeat.run(reservationId, seatIds.get(seatLabel), createdAt);
      }
    });
  });

  seed();
}

// "Begin at the beginning," the King said, "and go on till you come to the end: then stop." — Alice in Wonderland
