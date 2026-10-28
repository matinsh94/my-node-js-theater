// Reservation management: list your reservations, highlight one on the map,
// add or remove its seats by clicking the map, delete it (with confirmation).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatSeats, seatLabel } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import SeatMap from '../components/SeatMap.jsx';

export default function ReservationsPage() {
  const { authenticated, loading } = useAuth();
  const [reservations, setReservations] = useState(null);
  const [seats, setSeats] = useState(null);
  const [managedId, setManagedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [reservationData, seatData] = await Promise.all([api('/reservations'), api('/seats')]);
    setReservations(reservationData.reservations);
    setSeats(seatData.seats);
  }, []);

  useEffect(() => {
    if (authenticated) {
      load();
    }
  }, [authenticated, load]);

  const managed = useMemo(
    () => reservations?.find((r) => r.id === managedId) || null,
    [reservations, managedId]
  );

  const managedSeatIds = useMemo(
    () => (managed ? new Set(managed.seats.map((s) => s.id)) : null),
    [managed]
  );

  const mySeatIds = useMemo(
    () => new Set((reservations || []).flatMap((r) => r.seats.map((s) => s.id))),
    [reservations]
  );

  async function handleSeatClick(seat) {
    if (!managed) {
      setMessage({ kind: 'warning', text: 'Pick a reservation above first, then click the map to change its seats.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (managedSeatIds.has(seat.id)) {
        const data = await api(`/reservations/${managed.id}/seats/${seat.id}`, { method: 'DELETE' });
        setMessage({
          kind: 'success',
          text: `Removed seat ${seatLabel(seat)} from reservation #${managed.id}. It is released — you must wait 40 seconds before reserving it again.`,
        });
        setReservations((prev) => prev.map((r) => (r.id === managed.id ? data.reservation : r)));
      } else {
        const data = await api(`/reservations/${managed.id}/seats`, {
          method: 'POST',
          body: { seatIds: [seat.id] },
        });
        setMessage({
          kind: 'success',
          text: `Added seat ${seatLabel(seat)} to reservation #${managed.id}.`,
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
        // keep the old view if reload also fails
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteReservation(id) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/reservations/${id}`, { method: 'DELETE' });
      setMessage({
        kind: 'success',
        text: `Reservation #${id} deleted. Its seats are released (40-second re-booking cooldown applies).`,
      });
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
  if (!authenticated) {
    return (
      <div className="page narrow">
        <h1>My Reservations</h1>
        <div className="banner banner-warning" role="status">
          Please <Link to="/login">log in</Link> to see your reservations.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-head">
        <h1>My Reservations</h1>
        <p className="muted">
          Select a reservation to highlight its seats on the map, then click seats to add or remove them.
        </p>
      </section>

      {message && (
        <div className={`banner banner-${message.kind}`} role="status">
          {message.text}
        </div>
      )}

      {reservations === null ? (
        <p className="muted">Loading reservations…</p>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <p>You have no reservations yet.</p>
          <Link to="/" className="btn btn-primary">
            Go to the theater map
          </Link>
        </div>
      ) : (
        <ul className="reservation-list">
          {reservations.map((reservation) => (
            <li
              key={reservation.id}
              className={`reservation-card${managedId === reservation.id ? ' is-managed' : ''}`}
            >
              <div className="reservation-info">
                <span className="reservation-title">Reservation #{reservation.id}</span>
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
                    <span className="confirm-text">Delete reservation #{reservation.id}?</span>
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
          Managing reservation <strong>#{managed.id}</strong> — click one of its (amber) seats to remove it,
          or an available (green) seat to add it.
        </p>
      )}
      <SeatMap
        seats={seats || []}
        mySeatIds={mySeatIds}
        managedSeatIds={managedSeatIds}
        onSeatClick={managed ? handleSeatClick : undefined}
      />
    </div>
  );
}

// "Take some more tea," the March Hare said to Alice, very earnestly. — Alice in Wonderland
