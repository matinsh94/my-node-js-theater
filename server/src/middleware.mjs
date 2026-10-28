// Shared middleware: error type, auth guards and input-validation helpers.
// All authorization decisions happen here, on the server.

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true; // safe to show to the client
  }
}

// Wraps async route handlers so rejected promises reach the error handler.
export function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Requires a fully authenticated session (regular or admin role).
// A session that is still waiting for TOTP verification does not pass.
export function requireAuth(req, res, next) {
  if (req.isAuthenticated() && (req.session.role === 'user' || req.session.role === 'admin')) {
    return next();
  }
  return next(new ApiError(401, 'Authentication required. Please log in.', 'unauthenticated'));
}

// Requires an admin session (chosen at login and confirmed with TOTP).
export function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && req.session.role === 'admin') {
    return next();
  }
  return next(new ApiError(403, 'Admin privileges are required for this operation.', 'forbidden'));
}

// --- validation helpers ---------------------------------------------------

export function requireObject(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'Request body must be a JSON object.', 'invalid_input');
  }
}

export function parseId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, `Invalid ${name}: must be a positive integer.`, 'invalid_input');
  }
  return id;
}

export function parseSeatIdArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, 'seatIds must be a non-empty array of seat ids.', 'invalid_input');
  }
  if (value.length > 20) {
    throw new ApiError(400, 'A reservation can contain at most 20 seats.', 'invalid_input');
  }
  return value.map((seatId) => parseId(seatId, 'seat id'));
}

export function parseCategory(value) {
  if (value !== 'normal' && value !== 'premium') {
    throw new ApiError(400, "category must be 'normal' or 'premium'.", 'invalid_input');
  }
  return value;
}

export function parseCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new ApiError(400, 'count must be an integer between 1 and 20.', 'invalid_input');
  }
  return count;
}

// --- error handling -------------------------------------------------------

export function apiNotFound(req, res) {
  res.status(404).json({ error: { message: 'Unknown API endpoint.', code: 'not_found' } });
}

// Final error handler: never leaks stack traces or internal details.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res
      .status(err.status)
      .json({ error: { message: err.message, code: err.code || 'error' } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON in request body.', code: 'invalid_json' } });
  }
  console.error('[server] unhandled error:', err);
  return res
    .status(500)
    .json({ error: { message: 'Internal server error.', code: 'internal_error' } });
}

// "It would be so nice if something made sense for a change." — Alice in Wonderland
