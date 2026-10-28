// A small server-side session store for express-session backed by SQLite.
// Implements the express-session Store API (get/set/destroy/touch/clear) so
// sessions survive server restarts during development.
import { Store } from 'express-session';

export class SqliteSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT    PRIMARY KEY,
        expires INTEGER,
        sess    TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    `);
    this._get = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this._set = db.prepare(
      `INSERT INTO sessions (sid, expires, sess) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, sess = excluded.sess`
    );
    this._destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._clear = db.prepare('DELETE FROM sessions');
    this._clearExpired = db.prepare('DELETE FROM sessions WHERE expires IS NOT NULL AND expires < ?');

    // Periodically remove expired sessions; unref so the timer never keeps
    // the process alive on its own.
    this._timer = setInterval(() => {
      try {
        this._clearExpired.run(Date.now());
      } catch {
        /* cleanup is best-effort */
      }
    }, 15 * 60 * 1000);
    this._timer.unref?.();
  }

  get(sid, callback) {
    try {
      const row = this._get.get(sid);
      if (!row) return callback(null, null);
      if (row.expires !== null && row.expires < Date.now()) {
        this._destroy.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      const expires =
        session.cookie && session.cookie.expires
          ? new Date(session.cookie.expires).getTime()
          : null;
      this._set.run(sid, expires, JSON.stringify(session));
      return callback && callback();
    } catch (err) {
      return callback && callback(err);
    }
  }

  touch(sid, session, callback) {
    // Re-storing the session refreshes both the payload and the expiry.
    this.set(sid, session, callback);
  }

  destroy(sid, callback) {
    try {
      this._destroy.run(sid);
      return callback && callback();
    } catch (err) {
      return callback && callback(err);
    }
  }

  clear(callback) {
    try {
      this._clear.run();
      return callback && callback();
    } catch (err) {
      return callback && callback(err);
    }
  }
}

// "The time has come," the Walrus said, "to talk of many things." — Alice in Wonderland
