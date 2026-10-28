// Application factory: wires together the database, session handling,
// Passport, CORS and every API router. Exported separately from index.mjs
// so the test suite can build isolated app instances.
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { openDatabase, DEFAULT_DB_PATH } from './db.mjs';
import { seedDatabase } from './seed.mjs';
import { SqliteSessionStore } from './sessionStore.mjs';
import { configurePassport, createAuthRouter } from './auth.mjs';
import { createSeatsRouter } from './seats.mjs';
import { createReservationsRouter } from './reservations.mjs';
import { createAdminRouter } from './admin.mjs';
import { apiNotFound, errorHandler } from './middleware.mjs';

export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

export function createApp({ dbPath } = {}) {
  const resolvedPath = dbPath || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = openDatabase(resolvedPath);
  seedDatabase(db);
  configurePassport(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(
    cors({
      origin: CLIENT_ORIGIN,
      credentials: true,
    })
  );
  app.use(
    session({
      name: 'theater.sid',
      secret: process.env.SESSION_SECRET || 'theater-dev-session-secret',
      resave: false,
      saveUninitialized: false,
      store: new SqliteSessionStore(db),
      cookie: {
        httpOnly: true,
        sameSite: 'lax', // localhost:5173 -> localhost:3000 is same-site
        secure: false, // plain HTTP in local development
        maxAge: 8 * 60 * 60 * 1000,
      },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/seats', createSeatsRouter(db));
  app.use('/api/reservations', createReservationsRouter(db));
  app.use('/api/admin', createAdminRouter(db));

  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return { app, db };
}

// "Who in the world am I? Ah, that's the great puzzle." — Alice in Wonderland
