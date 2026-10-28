// Tiny fetch wrapper around the backend REST API.
// Always sends session cookies (credentials: "include") — the backend runs on
// http://localhost:3000 with CORS configured for the Vite origin.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export class ApiRequestError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON body (should not happen with our API)
  }
  if (!res.ok) {
    throw new ApiRequestError(
      payload?.error?.message || `Request failed with status ${res.status}.`,
      payload?.error?.code || 'error',
      res.status
    );
  }
  return payload?.data ?? {};
}

export function seatLabel(seat) {
  return `${seat.row}${seat.number}`;
}

export function formatSeats(seats) {
  return seats.map(seatLabel).join(', ');
}

// "Oh, you can't help that," said the Cat: "we're all mad here." — Alice in Wonderland
