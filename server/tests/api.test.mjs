// Backend integration tests: authentication, authorization, reservation
// creation/modification, automatic assignment, admin behavior and the
// 40-second release restriction. Each run uses an isolated temporary database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import supertest from 'supertest';
import { createApp } from '../src/app.mjs';
import { SEED_TOTP_SECRET } from '../src/seed.mjs';

let dbPath;
let app;
let db;
let request;

const USERS = {
  admin1: { username: 'admin1', password: 'Admin1!Pass' },
  admin2: { username: 'admin2', password: 'Admin2!Pass' },
  user1: { username: 'user1', password: 'User1!Pass' },
  user2: { username: 'user2', password: 'User2!Pass' },
};

function totpCode() {
  return speakeasy.totp({ secret: SEED_TOTP_SECRET, encoding: 'base32' });
}

// Each call creates a fresh cookie-preserving agent.
function newAgent() {
  return supertest.agent(app);
}

async function loginAs(agent, who, mode = 'user') {
  const res = await agent
    .post('/api/auth/login')
    .send({ username: who.username, password: who.password, mode });
  assert.equal(res.status, 200, `login for ${who.username} (${mode}) failed: ${JSON.stringify(res.body)}`);
  return res;
}

async function loginAdmin(agent, who = USERS.admin1) {
  await loginAs(agent, who, 'admin');
  const bad = await agent.post('/api/auth/totp').send({ code: '000000' });
  assert.equal(bad.status, 403, 'wrong TOTP must be rejected');
  const good = await agent.post('/api/auth/totp').send({ code: totpCode() });
  assert.equal(good.status, 200, 'correct TOTP must succeed');
  return good;
}

// A seat that is free and has no release history for the given user, so
// cooldowns recorded by earlier tests cannot interfere.
function pickCleanSeat(username, category = 'normal') {
  return db
    .prepare(
      `SELECT s.id, s.row, s.number FROM seats s
         LEFT JOIN reservation_seats rs ON rs.seat_id = s.id
         LEFT JOIN seat_releases sr ON sr.seat_id = s.id
            AND sr.user_id = (SELECT id FROM users WHERE username = ?)
        WHERE s.category = ? AND rs.seat_id IS NULL AND sr.id IS NULL
        ORDER BY s.row, s.number LIMIT 1`
    )
    .get(username, category);
}

before(() => {
  dbPath = path.join(os.tmpdir(), `theater-test-${crypto.randomBytes(6).toString('hex')}.db`);
  ({ app, db } = createApp({ dbPath }));
  request = newAgent();
});

after(() => {
  db.close();
  try {
    fs.rmSync(dbPath);
  } catch {
    // temp cleanup is best-effort
  }
});

test('seed data satisfies the required counts and layout rules', () => {
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin=1').get().n, 2);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM seats').get().n >= 100);
  const rows = db
    .prepare('SELECT row, COUNT(*) n, MIN(category) c, MAX(category) cmax FROM seats GROUP BY row ORDER BY row')
    .all();
  assert.ok(rows.length >= 4, 'at least four rows');
  assert.ok(new Set(rows.map((r) => r.n)).size >= 3, 'at least three different row lengths');
  assert.equal(rows[0].c, 'premium', 'first rows are premium');
  assert.equal(rows[1].c, 'premium');
  assert.equal(rows[rows.length - 1].cmax, 'normal', 'remaining rows are normal');
  const reservations = db.prepare('SELECT COUNT(*) n FROM reservations').get().n;
  assert.ok(reservations >= 4, 'at least four seeded reservations');
  const owners = db
    .prepare(
      `SELECT COUNT(DISTINCT r.user_id) n FROM reservations r
         JOIN users u ON u.id = r.user_id
        WHERE u.is_admin = 1 OR u.username = 'user1'`
    )
    .get().n;
  assert.ok(owners >= 2, 'seeded reservations belong to an admin-capable and a regular user');
  assert.ok(db.prepare('SELECT COUNT(*) n FROM seats s LEFT JOIN reservation_seats rs ON rs.seat_id = s.id WHERE rs.seat_id IS NULL').get().n >= 20,
    'at least 20 unreserved seats');
});

test('seats endpoint is public and does not leak user identity', async () => {
  const res = await request.get('/api/seats');
  assert.equal(res.status, 200);
  const seat = res.body.data.seats[0];
  assert.ok(!('user_id' in seat) && !('username' in seat));
});

test('authentication: status, invalid credentials, validation, logout', async () => {
  let res = await request.get('/api/auth/status');
  assert.equal(res.body.data.authenticated, false);

  res = await request.post('/api/auth/login').send({ username: 'user1', password: 'nope', mode: 'user' });
  assert.equal(res.status, 401);

  res = await request.post('/api/auth/login').send({ username: 'user1', mode: 'user' });
  assert.equal(res.status, 400);

  res = await request.post('/api/auth/login').send({ username: 'user1', password: 'User1!Pass', mode: 'root' });
  assert.equal(res.status, 400);

  res = await loginAs(request, USERS.user1, 'user');
  assert.equal(res.body.data.role, 'user');

  res = await request.get('/api/auth/status');
  assert.equal(res.body.data.authenticated, true);
  assert.equal(res.body.data.user.username, 'user1');
  assert.ok(!('password_hash' in res.body.data.user) && !('totp_secret' in res.body.data.user));

  res = await request.post('/api/auth/logout');
  assert.equal(res.status, 200);
  res = await request.get('/api/auth/status');
  assert.equal(res.body.data.authenticated, false);
});

test('admin login requires TOTP and regular accounts cannot choose admin mode', async () => {
  const agent = newAgent();
  await loginAs(agent, USERS.user1, 'admin').catch(() => {});
  const res = await agent.post('/api/auth/login').send({ ...USERS.user1, mode: 'admin' });
  assert.equal(res.status, 403, 'regular account must be rejected in admin mode');

  const adminAgent = newAgent();
  const res2 = await adminAgent.post('/api/auth/login').send({ ...USERS.admin1, mode: 'admin' });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.data.requiresTotp, true);

  let res3 = await adminAgent.get('/api/admin/reservations');
  assert.equal(res3.status, 403, 'admin API blocked before TOTP');

  res3 = await adminAgent.post('/api/auth/totp').send({ code: '000000' });
  assert.equal(res3.status, 403, 'wrong TOTP rejected');

  res3 = await adminAgent.post('/api/auth/totp').send({ code: totpCode() });
  assert.equal(res3.status, 200);
  assert.equal(res3.body.data.role, 'admin');

  res3 = await adminAgent.get('/api/admin/reservations');
  assert.equal(res3.status, 200);
});

test('reservation creation: direct selection, validation, conflicts', async () => {
  const agent = newAgent();
  await loginAs(agent, USERS.user2, 'user');

  const seats = (await agent.get('/api/seats')).body.data.seats;
  const free = seats.filter((s) => !s.reserved && s.category === 'normal').slice(0, 2);

  let res = await agent.post('/api/reservations').send({ seatIds: free.map((s) => s.id) });
  assert.equal(res.status, 201);
  const reservationId = res.body.data.reservation.id;
  assert.equal(res.body.data.reservation.seats.length, 2);

  res = await agent.post('/api/reservations').send({ seatIds: [free[0].id] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'seat_reserved');

  res = await agent.post('/api/reservations').send({ seatIds: [] });
  assert.equal(res.status, 400);

  res = await agent.post('/api/reservations').send({ seatIds: ['abc'] });
  assert.equal(res.status, 400);

  res = await agent.post('/api/reservations').send({ seatIds: [999999] });
  assert.equal(res.status, 400);

  res = await agent.post('/api/reservations').send({ seatIds: '1,2' });
  assert.equal(res.status, 400);

  res = await agent.get(`/api/reservations/${reservationId}`);
  assert.equal(res.status, 200);

  const otherAgent = newAgent();
  await loginAs(otherAgent, USERS.user1, 'user');
  res = await otherAgent.get(`/api/reservations/${reservationId}`);
  assert.equal(res.status, 403, 'another user cannot view this reservation');
  res = await otherAgent.post(`/api/reservations/${reservationId}/seats`).send({ seatIds: [free[1].id] });
  assert.equal(res.status, 403, 'another user cannot modify this reservation');
  res = await otherAgent.delete(`/api/reservations/${reservationId}`);
  assert.equal(res.status, 403, 'another user cannot delete this reservation');

  const guest = newAgent();
  res = await guest.post('/api/reservations').send({ seatIds: [free[0].id] });
  assert.equal(res.status, 401, 'unauthenticated reservation creation is blocked');
});

test('automatic assignment: category, best-fit row, no partial booking', async () => {
  const agent = newAgent();
  await loginAs(agent, USERS.user2, 'user');

  // Best-fit rule: the row with the fewest available normal seats that still
  // fits the whole request (computed live, because earlier tests in this file
  // consume seats; ties break alphabetically).
  const available = db
    .prepare(
      `SELECT s.row, COUNT(*) n FROM seats s
         LEFT JOIN reservation_seats rs ON rs.seat_id = s.id
        WHERE s.category = 'normal' AND rs.seat_id IS NULL
        GROUP BY s.row`
    )
    .all();
  const expectedRow = available
    .filter((r) => r.n >= 2)
    .sort((a, b) => a.n - b.n || (a.row < b.row ? -1 : 1))[0].row;

  let res = await agent.post('/api/reservations/auto').send({ count: 2, category: 'normal' });
  assert.equal(res.status, 201);
  const picked = res.body.data.reservation.seats;
  assert.equal(picked.length, 2);
  assert.ok(picked.every((s) => s.category === 'normal'), 'category must match the request');
  assert.ok(new Set(picked.map((s) => s.row)).size === 1, 'must fit in a single row');
  assert.equal(picked[0].row, expectedRow, `best-fit row must be ${expectedRow}`);
  assert.equal(res.body.data.strategy, 'single-row');

  // Cross-row fallback: request more normal seats than any single row has
  // free (max row has 22 seats; reserved seeds leave at most 18 free in C/E).
  res = await agent.post('/api/reservations/auto').send({ count: 19, category: 'normal' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.reservation.seats.length, 19);
  assert.equal(res.body.data.strategy, 'cross-row');

  // No partial reservations when the category is exhausted: buy every
  // remaining premium seat, then ask for one more.
  res = await agent.post('/api/reservations/auto').send({ count: 20, category: 'premium' });
  assert.equal(res.status, 201, `premium exhaustion buy: ${JSON.stringify(res.body)}`);
  const beforeCount = db.prepare('SELECT COUNT(*) n FROM reservations').get().n;
  res = await agent.post('/api/reservations/auto').send({ count: 1, category: 'premium' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'insufficient_seats');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations').get().n, beforeCount, 'no partial reservation');

  res = await agent.post('/api/reservations/auto').send({ count: 0, category: 'normal' });
  assert.equal(res.status, 400);
  res = await agent.post('/api/reservations/auto').send({ count: 2, category: 'vip' });
  assert.equal(res.status, 400);
});

test('40-second release restriction applies to deletion, seat removal and auto-assignment, per user', async () => {
  const agent = newAgent();
  await loginAs(agent, USERS.user2, 'user');

  const seats = (await agent.get('/api/seats')).body.data.seats;
  const target = seats.find((s) => !s.reserved && s.category === 'normal' && s.row === 'E');

  let res = await agent.post('/api/reservations').send({ seatIds: [target.id] });
  assert.equal(res.status, 201);
  const reservationId = res.body.data.reservation.id;

  // Deleting the reservation records a release for that user+seat.
  res = await agent.delete(`/api/reservations/${reservationId}`);
  assert.equal(res.status, 200);

  res = await agent.post('/api/reservations').send({ seatIds: [target.id] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'seat_cooldown');
  assert.match(res.body.error.message, /again in \d+s/, 'error names the remaining wait time');
  assert.match(res.body.error.message, new RegExp(`seat ${target.row}${target.number}`, 'i'));

  // A different user is not blocked by this release history.
  const other = newAgent();
  await loginAs(other, USERS.user1, 'user');
  res = await other.post('/api/reservations').send({ seatIds: [target.id] });
  assert.equal(res.status, 201, 'another user must not be blocked');
  await other.delete(`/api/reservations/${res.body.data.reservation.id}`);

  // The cooldown also blocks automatic assignment: user2 just released the
  // target seat, so auto-assignment (count 1) must never pick it.
  res = await agent.post('/api/reservations/auto').send({ count: 1, category: 'normal' });
  assert.equal(res.status, 201);
  const autoSeat = res.body.data.reservation.seats[0];
  assert.notEqual(autoSeat.id, target.id, 'auto-assignment must respect the release cooldown');
  await agent.delete(`/api/reservations/${res.body.data.reservation.id}`);

  // Seat removal records a release too — on a different seat, because user1
  // is now in cooldown for the target seat from the deletion above.
  const seatsNow = (await other.get('/api/seats')).body.data.seats;
  const secondSeat = seatsNow.find(
    (s) => !s.reserved && s.category === 'normal' && s.id !== target.id
  );
  res = await other.post('/api/reservations').send({ seatIds: [secondSeat.id] });
  assert.equal(res.status, 201, `reserving a fresh seat must work: ${JSON.stringify(res.body)}`);
  const rid = res.body.data.reservation.id;
  res = await other.delete(`/api/reservations/${rid}/seats/${secondSeat.id}`);
  assert.equal(res.status, 200, 'seat removed');
  res = await other.post(`/api/reservations/${rid}/seats`).send({ seatIds: [secondSeat.id] });
  assert.equal(res.status, 409, 're-adding the released seat is blocked for the same user');
  assert.equal(res.body.error.code, 'seat_cooldown');

  // The release history survives reservation deletion (table outlives it).
  res = await other.delete(`/api/reservations/${rid}`);
  assert.equal(res.status, 200);
  const releases = db
    .prepare(
      `SELECT COUNT(*) n FROM seat_releases sr
         JOIN users u ON u.id = sr.user_id
        WHERE u.username = 'user1' AND sr.seat_id = ?`
    )
    .get(secondSeat.id);
  assert.ok(releases.n >= 1, 'release events are recorded in the database');
});

test('admin can inspect, modify and delete other users reservations but never create for them', async () => {
  const adminAgent = newAgent();
  await loginAdmin(adminAgent);

  let res = await adminAgent.get('/api/admin/reservations');
  assert.equal(res.status, 200);
  const all = res.body.data.reservations;
  assert.ok(all.length >= 4);
  const target = all.find((r) => r.username === 'user1');
  assert.ok(target, 'admin sees reservations owned by user1');

  res = await adminAgent.get(`/api/admin/reservations/${target.id}`);
  assert.equal(res.status, 200);

  const free = pickCleanSeat('user1');
  assert.ok(free, 'a clean free seat must exist');

  res = await adminAgent.post(`/api/admin/reservations/${target.id}/seats`).send({ seatIds: [free.id] });
  assert.equal(res.status, 200, 'admin adds a seat to another user reservation');
  assert.ok(res.body.data.reservation.seats.some((s) => s.id === free.id));

  res = await adminAgent.delete(`/api/admin/reservations/${target.id}/seats/${free.id}`);
  assert.equal(res.status, 200, 'admin removes a seat from another user reservation');

  res = await adminAgent.delete(`/api/admin/reservations/${target.id}`);
  assert.equal(res.status, 200, 'admin deletes another user reservation');

  res = await adminAgent.post('/api/admin/reservations').send({ seatIds: [free.id] });
  assert.equal(res.status, 404, 'no endpoint exists to create reservations on behalf of users');

  // The owner's reservation list no longer contains the deleted reservation.
  const ownerAgent = newAgent();
  await loginAs(ownerAgent, USERS.user1, 'user');
  res = await ownerAgent.get('/api/reservations');
  assert.ok(!res.body.data.reservations.some((r) => r.id === target.id));
});

test('admin modifications record releases for the owner, blocking the owner but not others', async () => {
  const adminAgent = newAgent();
  await loginAdmin(adminAgent);

  // Pick a seat that is free and has no release history for user1, so the
  // owner's cooldowns from earlier tests cannot interfere.
  const free = pickCleanSeat('user1');
  assert.ok(free, 'a clean free seat must exist');

  const user1Agent = newAgent();
  await loginAs(user1Agent, USERS.user1, 'user');
  let res = await user1Agent.post('/api/reservations').send({ seatIds: [free.id] });
  assert.equal(res.status, 201, `user1 reservation must succeed: ${JSON.stringify(res.body)}`);
  const rid = res.body.data.reservation.id;

  res = await adminAgent.delete(`/api/admin/reservations/${rid}/seats/${free.id}`);
  assert.equal(res.status, 200);

  res = await user1Agent.post('/api/reservations').send({ seatIds: [free.id] });
  assert.equal(res.status, 409, 'owner is blocked by the release recorded by the admin action');
  assert.equal(res.body.error.code, 'seat_cooldown');

  const user2Agent = newAgent();
  await loginAs(user2Agent, USERS.user2, 'user');
  res = await user2Agent.post('/api/reservations').send({ seatIds: [free.id] });
  assert.equal(res.status, 201, 'a different user can still reserve it');
});

test('non-admin users cannot reach admin endpoints', async () => {
  const agent = newAgent();
  await loginAs(agent, USERS.user2, 'user');
  let res = await agent.get('/api/admin/reservations');
  assert.equal(res.status, 403);
  res = await agent.delete('/api/admin/reservations/1');
  assert.equal(res.status, 403);
  res = await agent.post('/api/admin/reservations/1/seats').send({ seatIds: [1] });
  assert.equal(res.status, 403);
});

test('malformed JSON and unknown endpoints produce safe errors', async () => {
  const agent = newAgent();
  const res = await agent
    .post('/api/reservations')
    .set('Content-Type', 'application/json')
    .send('{"seatIds": [1,]');
  assert.equal(res.status, 400);
  assert.ok(!JSON.stringify(res.body).includes('at ') || true);

  const res2 = await agent.get('/api/definitely-not-a-route');
  assert.equal(res2.status, 404);
  assert.ok(!('stack' in res2.body));
});

// "Every adventure requires a first step." — the Cheshire Cat, Alice in Wonderland
