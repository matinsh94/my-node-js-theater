// Database layer: opens the SQLite database, creates the schema and exposes
// a few small data-access helpers shared by the API routes.
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const SEAT_COOLDOWN_MS = 40_000; // 40-second release restriction

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/theater.db', import.meta.url));

export function openDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
      totp_secret   TEXT
    );

    CREATE TABLE IF NOT EXISTS seats (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      row      TEXT    NOT NULL,
      number   INTEGER NOT NULL CHECK (number >= 1),
      category TEXT    NOT NULL CHECK (category IN ('premium', 'normal')),
      UNIQUE (row, number)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);

    -- A seat can belong to at most one reservation at a time; the UNIQUE
    -- constraint on seat_id is the last line of defence against double booking.
    CREATE TABLE IF NOT EXISTS reservation_seats (
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      seat_id        INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      added_at       INTEGER NOT NULL,
      PRIMARY KEY (reservation_id, seat_id),
      UNIQUE (seat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reservation_seats_seat ON reservation_seats(seat_id);

    -- Release history is kept forever: it powers the 40-second re-booking
    -- restriction and survives reservation deletion.
    CREATE TABLE IF NOT EXISTS seat_releases (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seat_id     INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      released_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seat_releases_user_seat_time
      ON seat_releases(user_id, seat_id, released_at);
  `);
}

// --- shared helpers -------------------------------------------------------

export function findUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Returns every seat joined with its current reservation owner (if any).
export function getAllSeats(db) {
  return db
    .prepare(
      `SELECT s.id, s.row, s.number, s.category,
              rs.reservation_id AS reservation_id
         FROM seats s
         LEFT JOIN reservation_seats rs ON rs.seat_id = s.id
        ORDER BY s.row, s.number`
    )
    .all();
}

export function getSeatsByIds(db, seatIds) {
  const placeholders = seatIds.map(() => '?').join(', ');
  return db
    .prepare(`SELECT id, row, number, category FROM seats WHERE id IN (${placeholders})`)
    .all(...seatIds);
}

export function seatIdsOfReservation(db, reservationId) {
  return db
    .prepare('SELECT seat_id FROM reservation_seats WHERE reservation_id = ?')
    .all(reservationId)
    .map((r) => r.seat_id);
}

// Latest release (within the cooldown window) for a user+seat pair, if any.
export function getActiveRelease(db, userId, seatId, now = Date.now()) {
  return db
    .prepare(
      `SELECT released_at FROM seat_releases
        WHERE user_id = ? AND seat_id = ? AND released_at > ?
        ORDER BY released_at DESC LIMIT 1`
    )
    .get(userId, seatId, now - SEAT_COOLDOWN_MS);
}

export function recordReleases(db, userId, seatIds, now = Date.now()) {
  const insert = db.prepare(
    'INSERT INTO seat_releases (user_id, seat_id, released_at) VALUES (?, ?, ?)'
  );
  for (const seatId of seatIds) insert.run(userId, seatId, now);
}

// "Why, sometimes I've believed as many as six impossible things before breakfast." — Alice in Wonderland
