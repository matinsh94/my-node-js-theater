// Authentication: Passport.js local strategy, server-side sessions and the
// two-step admin login (password first, then TOTP verification).
import express from 'express';
import passport from 'passport';
import LocalStrategy from 'passport-local';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import { ApiError, wrap, requireObject } from './middleware.mjs';
import { findUserByUsername, findUserById } from './db.mjs';

export function configurePassport(db) {
  passport.use(
    new LocalStrategy({ usernameField: 'username', passwordField: 'password' }, (username, password, done) => {
      const user = findUserByUsername(db, String(username || ''));
      if (!user) {
        return done(null, false, { message: 'Invalid username or password.' });
      }
      bcrypt.compare(String(password || ''), user.password_hash, (err, matched) => {
        if (err) return done(err);
        if (!matched) return done(null, false, { message: 'Invalid username or password.' });
        return done(null, { id: user.id, username: user.username, isAdmin: user.is_admin === 1 });
      });
    })
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = findUserById(db, id);
    if (!user) return done(null, false);
    return done(null, { id: user.id, username: user.username, isAdmin: user.is_admin === 1 });
  });
}

function publicUser(user) {
  return { id: user.id, username: user.username, isAdminCapable: Boolean(user.isAdmin) };
}

export function createAuthRouter(db) {
  const router = express.Router();

  // POST /api/auth/login  { username, password, mode: "user" | "admin" }
  // Regular mode establishes a normal session immediately. Admin mode
  // establishes a pending session that only becomes an admin session after
  // POST /api/auth/totp succeeds.
  router.post(
    '/login',
    wrap(async (req, res, next) => {
      requireObject(req.body);
      const { username, password, mode } = req.body;
      if (typeof username !== 'string' || username.length === 0) {
        throw new ApiError(400, 'username is required.', 'invalid_input');
      }
      if (typeof password !== 'string' || password.length === 0) {
        throw new ApiError(400, 'password is required.', 'invalid_input');
      }
      if (mode !== 'user' && mode !== 'admin') {
        throw new ApiError(400, "mode must be 'user' or 'admin'.", 'invalid_input');
      }

      passport.authenticate('local', (err, user) => {
        if (err) return next(err);
        if (!user) {
          return res
            .status(401)
            .json({ error: { message: 'Invalid username or password.', code: 'invalid_credentials' } });
        }
        if (mode === 'admin' && !user.isAdmin) {
          return res.status(403).json({
            error: { message: 'This account does not have admin privileges.', code: 'forbidden' },
          });
        }

        // Regenerate the session after successful authentication to prevent
        // session fixation, then log the user in.
        req.session.regenerate((regenErr) => {
          if (regenErr) return next(regenErr);
          req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            if (mode === 'admin') {
              req.session.pendingAdmin = true; // admin role only after TOTP
              req.session.save(() => {
                res.status(200).json({ success: true, data: { requiresTotp: true } });
              });
            } else {
              req.session.role = 'user';
              req.session.save(() => {
                res.status(200).json({ success: true, data: { user: publicUser(user), role: 'user' } });
              });
            }
          });
        });
      })(req, res, next);
    })
  );

  // POST /api/auth/totp  { code: "123456" }  — completes an admin login.
  router.post(
    '/totp',
    wrap(async (req, res, next) => {
      requireObject(req.body);
      const { code } = req.body;
      if (!req.isAuthenticated() || !req.session.pendingAdmin) {
        throw new ApiError(401, 'Complete the admin login first.', 'unauthenticated');
      }
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        throw new ApiError(400, 'code must be a 6-digit TOTP code.', 'invalid_input');
      }
      const dbUser = findUserById(db, req.user.id);
      if (!dbUser || !dbUser.is_admin || !dbUser.totp_secret) {
        throw new ApiError(403, 'This account cannot complete admin verification.', 'forbidden');
      }
      const verified = speakeasy.totp.verify({
        secret: dbUser.totp_secret,
        encoding: 'base32',
        token: code,
        window: 1,
      });
      if (!verified) {
        return res
          .status(403)
          .json({ error: { message: 'Invalid or expired TOTP code.', code: 'invalid_totp' } });
      }
      req.session.pendingAdmin = false;
      req.session.role = 'admin';
      req.session.save(() => {
        res.status(200).json({ success: true, data: { user: publicUser(req.user), role: 'admin' } });
      });
    })
  );

  // GET /api/auth/status — who is logged in, and in which role.
  // Like every other endpoint, the payload is wrapped in the standard
  // { success, data } envelope so the client's api() helper can unwrap it.
  router.get('/status', (req, res) => {
    if (req.isAuthenticated() && req.session.pendingAdmin) {
      return res.json({ success: true, data: { authenticated: false, awaitingTotp: true } });
    }
    if (req.isAuthenticated() && (req.session.role === 'user' || req.session.role === 'admin')) {
      return res.json({
        success: true,
        data: { authenticated: true, user: publicUser(req.user), role: req.session.role },
      });
    }
    return res.json({ success: true, data: { authenticated: false } });
  });

  // POST /api/auth/logout — destroys the session server-side.
  router.post('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('theater.sid');
        res.json({ success: true, data: { message: 'Logged out.' } });
      });
    });
  });

  return router;
}

// "Curiouser and curiouser!" cried Alice. — Alice in Wonderland
