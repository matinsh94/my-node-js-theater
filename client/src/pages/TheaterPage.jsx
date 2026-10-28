// Public theater page: seat map + direct selection + automatic assignment.
// The map is visible to guests; reserving requires logging in.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatSeats } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import SeatMap from '../components/SeatMap.jsx';

const MAX_SELECTION = 20;

export default function TheaterPage() {
  const { authenticated, role } = useAuth();
  const [seats, setSeats] = useState(null);
  const [mySeatIds, setMySeatIds] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [message, setMessage] = useState(null); // { kind: 'success'|'error'|'warning', text }
  const [busy, setBusy] = useState(false);
  const [autoCount, setAutoCount] = useState(2);
  const [autoCategory, setAutoCategory] = useState('normal');

  const loadSeats = useCallback(async () => {
    const data = await api('/seats');
    setSeats(data.seats);
  }, []);

  const loadMyReservations = useCallback(async () => {
    if (!authenticated) {
      setMySeatIds(null);
      return;
    }
    try {
      const data = await api('/reservations');
      setMySeatIds(new Set(data.reservations.flatMap((r) => r.seats.map((s) => s.id))));
    } catch {
      setMySeatIds(null);
    }
  }, [authenticated]);

  useEffect(() => {
    loadSeats();
  }, [loadSeats]);

  useEffect(() => {
    loadMyReservations();
  }, [loadMyReservations]);

  const selectedSeats = useMemo(
    () => (seats || []).filter((seat) => selectedIds.has(seat.id)),
    [seats, selectedIds]
  );

  function toggleSeat(seat) {
    setMessage(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
      } else if (next.size >= MAX_SELECTION) {
        setMessage({ kind: 'warning', text: `You can select at most ${MAX_SELECTION} seats at once.` });
        return prev;
      } else {
        next.add(seat.id);
      }
      return next;
    });
  }

  async function reserveSelected() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api('/reservations', {
        method: 'POST',
        body: { seatIds: [...selectedIds] },
      });
      setMessage({
        kind: 'success',
        text: `Reservation #${data.reservation.id} confirmed for ${formatSeats(data.reservation.seats)}.`,
      });
      setSelectedIds(new Set());
      await Promise.all([loadSeats(), loadMyReservations()]);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
      await loadSeats();
    } finally {
      setBusy(false);
    }
  }

  async function reserveAutomatic() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api('/reservations/auto', {
        method: 'POST',
        body: { count: autoCount, category: autoCategory },
      });
      const strategy =
        data.strategy === 'single-row'
          ? 'all in one row (best-fit row)'
          : 'across rows (no single row had enough room)';
      setMessage({
        kind: 'success',
        text: `Reservation #${data.reservation.id} confirmed: ${formatSeats(data.reservation.seats)} (${strategy}).`,
      });
      await Promise.all([loadSeats(), loadMyReservations()]);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
      await loadSeats();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <section className="page-head">
        <h1>Theater Seat Map</h1>
        <p className="muted">
          Pick your seats directly on the map, or let us assign them automatically.{' '}
          {!authenticated && (
            <>
              You are browsing as a guest — <Link to="/login">log in</Link> to reserve.
            </>
          )}
          {authenticated && role === 'admin' && <> You are working in <strong>admin mode</strong>.</>}
        </p>
      </section>

      {message && (
        <div className={`banner banner-${message.kind}`} role="status">
          {message.text}
        </div>
      )}

      <div className="theater-layout">
        <SeatMap
          seats={seats || []}
          selectedIds={selectedIds}
          mySeatIds={mySeatIds}
          onSeatClick={authenticated ? toggleSeat : undefined}
        />

        <aside className="panel booking-panel">
          <h2>Direct selection</h2>
          {selectedSeats.length === 0 ? (
            <p className="muted">No seats selected yet. Click available seats on the map.</p>
          ) : (
            <p>
              Selected: <strong>{formatSeats(selectedSeats)}</strong>
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!authenticated || selectedSeats.length === 0 || busy}
            onClick={reserveSelected}
          >
            {busy ? 'Reserving…' : `Reserve ${selectedSeats.length || ''} seat${selectedSeats.length === 1 ? '' : 's'}`}
          </button>
          {!authenticated && <p className="hint">Log in to reserve selected seats.</p>}

          <h2>Automatic assignment</h2>
          <label className="field">
            Number of seats
            <input
              type="number"
              min="1"
              max="20"
              value={autoCount}
              onChange={(e) => setAutoCount(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            Category
            <select value={autoCategory} onChange={(e) => setAutoCategory(e.target.value)} disabled={busy}>
              <option value="normal">Normal</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!authenticated || busy}
            onClick={reserveAutomatic}
          >
            Assign seats for me
          </button>
          {!authenticated && <p className="hint">Log in to use automatic assignment.</p>}
        </aside>
      </div>
    </div>
  );
}

// "Look at the sky, and see how the clouds are chasing one another." — Alice in Wonderland
