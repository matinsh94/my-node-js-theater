// Admin dashboard: every user's reservation, inspectable, modifiable and
// deletable. Admins cannot create reservations for other users (by design,
// the API has no such endpoint).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatSeats, seatLabel } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import SeatMap from '../components/SeatMap.jsx';

export default function AdminPage() {
  const { loading, authenticated, role } = useAuth();
  const [reservations, setReservations] = useState(null);
  const [users, setUsers] = useState(null);
  const [seats, setSeats] = useState(null);
  const [managedId, setManagedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [allReservations, allUsers, seatData] = await Promise.all([
      api('/admin/reservations'),
      api('/admin/users'),
      api('/seats'),
    ]);
    setReservations(allReservations.reservations);
    setUsers(allUsers.users);
    setSeats(seatData.seats);
  }, []);

  useEffect(() => {
    if (authenticated && role === 'admin') {
      load();
    }
  }, [authenticated, role, load]);

  const managed = useMemo(
    () => reservations?.find((r) => r.id === managedId) || null,
    [reservations, managedId]
  );
  const managedSeatIds = useMemo(
    () => (managed ? new Set(managed.seats.map((s) => s.id)) : null),
    [managed]
  );

  async function handleSeatClick(seat) {
    if (!managed) {
      setMessage({ kind: 'warning', text: 'Select a reservation first, then click seats to modify it.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (managedSeatIds.has(seat.id)) {
        const data = await api(`/admin/reservations/${managed.id}/seats/${seat.id}`, { method: 'DELETE' });
        setMessage({
          kind: 'success',
          text: `Removed seat ${seatLabel(seat)} from ${managed.username}'s reservation #${managed.id}.`,
        });
        setReservations((prev) => prev.map((r) => (r.id === managed.id ? data.reservation : r)));
      } else {
        const data = await api(`/admin/reservations/${managed.id}/seats`, {
          method: 'POST',
          body: { seatIds: [seat.id] },
        });
        setMessage({
          kind: 'success',
          text: `Added seat ${seatLabel(seat)} to ${managed.username}'s reservation #${managed.id}.`,
        });
        setReservations((prev) => prev.map((r) => (r.id === managed.id ? data.reservation : r)));
      }
      const seatData = await api('/seats');
      setSeats(seatData.seats);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
      try {
        await load();
      } catch {
        // keep old view
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteReservation(id) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/admin/reservations/${id}`, { method: 'DELETE' });
      setMessage({ kind: 'success', text: `Reservation #${id} deleted.` });
      if (managedId === id) setManagedId(null);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
      setConfirmDeleteId(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="page"><p className="muted">Checking session…</p></div>;
  }
  if (!authenticated || role !== 'admin') {
    return (
      <div className="page narrow">
        <h1>Admin</h1>
        <div className="banner banner-warning" role="status">
          This area requires an admin session.{' '}
          <Link to="/login">Log in</Link> with an admin-capable account, choose the <strong>Admin</strong> mode
          and complete TOTP verification.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-head">
        <h1>Admin Dashboard</h1>
        <p className="muted">
          Inspect, modify or delete any reservation. Admins never create reservations on behalf of other users.
        </p>
      </section>

      {message && (
        <div className={`banner banner-${message.kind}`} role="status">
          {message.text}
        </div>
      )}

      {users && (
        <section className="panel users-panel">
          <h2>Users</h2>
          <ul className="user-list">
            {users.map((user) => (
              <li key={user.id}>
                <strong>{user.username}</strong>
                {user.isAdmin && <span className="role-pill role-admin">admin-capable</span>}
                {!user.isAdmin && <span className="role-pill role-user">regular</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reservations === null ? (
        <p className="muted">Loading reservations…</p>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <p>No reservations exist at all.</p>
        </div>
      ) : (
        <ul className="reservation-list">
          {reservations.map((reservation) => (
            <li
              key={reservation.id}
              className={`reservation-card${managedId === reservation.id ? ' is-managed' : ''}`}
            >
              <div className="reservation-info">
                <span className="reservation-title">
                  #{reservation.id} — owned by <strong>{reservation.username}</strong>
                  {reservation.userId === managed?.userId && managedId === reservation.id ? ' (you)' : ''}
                </span>
                <span className="muted">{new Date(reservation.createdAt).toLocaleString()}</span>
                <span className="reservation-seats">{formatSeats(reservation.seats) || 'No seats'}</span>
              </div>
              <div className="reservation-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setManagedId(managedId === reservation.id ? null : reservation.id)}
                >
                  {managedId === reservation.id ? 'Stop managing' : 'Manage on map'}
                </button>
                {confirmDeleteId === reservation.id ? (
                  <>
                    <span className="confirm-text">Delete #{reservation.id} ({reservation.username})?</span>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      disabled={busy}
                      onClick={() => deleteReservation(reservation.id)}
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small btn-danger-outline"
                    onClick={() => setConfirmDeleteId(reservation.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {managed && (
        <p className="managed-note">
          Managing reservation <strong>#{managed.id}</strong> owned by <strong>{managed.username}</strong> —
          click an amber seat to remove it, or a green seat to add it.
        </p>
      )}
      <SeatMap seats={seats || []} managedSeatIds={managedSeatIds} onSeatClick={managed ? handleSeatClick : undefined} />
    </div>
  );
}

// "No, no!" said the Queen. "Sentence first — verdict afterwards." — Alice in Wonderland
