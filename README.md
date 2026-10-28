# Wonderland Theater — Seat Reservation

A full-stack theater seat reservation app. Express + SQLite backend with
Passport sessions and TOTP-verified admin login, React (Vite) frontend with a
clickable seat map.

## Run it

Two terminals:

```bash
# Terminal 1 — API on http://localhost:3000
cd server
npm install
npm start          # or: npm run dev (nodemon)

# Terminal 2 — UI on http://localhost:5173
cd client
npm install
npm run dev
```

The database (`server/data/theater.db`) is created and seeded automatically on
first start. Delete the file to reset to a fresh seed.

## Test accounts

| Username | Password      | Role          |
| -------- | ------------- | ------------- |
| admin1   | `Admin1!Pass` | admin-capable |
| admin2   | `Admin2!Pass` | admin-capable |
| user1    | `User1!Pass`  | regular       |
| user2    | `User2!Pass`  | regular       |

Admin login is two-step: choose **Admin** mode on the login page, then enter a
6-digit TOTP code. For local testing, print the current code with:

```bash
cd server
npm run totp
```

## Features

- Public seat map (guests can browse; reserving requires login).
- Direct seat selection (up to 20 seats) and automatic assignment with a
  best-fit rule: smallest row that fits the whole request, tie-broken
  alphabetically; cross-row fallback; never a partial reservation.
- Reservations page: manage seats on the map (add/remove by clicking) or delete
  a reservation, with confirmation.
- 40-second release restriction: after a seat is released (seat removal or
  reservation deletion), the same user cannot re-reserve it for 40 seconds.
  Other users are unaffected; release history survives reservation deletion.
- Admin mode (password + TOTP): view every user and reservation, add/remove
  seats, delete any reservation. Admins cannot create reservations on behalf of
  other users — that endpoint does not exist.
- Every success response uses the `{ success, data }` envelope; errors use
  `{ error: { message, code } }` and never leak stack traces.

## Tests

```bash
cd server
npm test
```

Integration tests (node:test + supertest) run against an isolated temporary
database and cover seeding, auth, TOTP, authorization boundaries, reservation
flows, auto-assignment strategy, the 40-second rule and admin behavior.

## Project layout

```
server/            Express API (ESM)
  index.mjs        entry point (port 3000)
  src/app.mjs      app factory: DB, sessions, Passport, CORS, routers
  src/db.mjs       schema + shared data helpers
  src/seed.mjs     first-run seeding (users, seats, reservations)
  src/auth.mjs     login / TOTP / status / logout
  src/seats.mjs    public seat map
  src/reservations.mjs  reservation CRUD + auto-assignment + cooldown
  src/admin.mjs    admin API
  tests/           integration tests
client/            React 19 + Vite 7 SPA
  src/pages/       Theater, Login, Reservations, Admin
  src/components/  Layout, SeatMap
```
