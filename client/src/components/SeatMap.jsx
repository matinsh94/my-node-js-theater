// The theater seat map. Renders every seat as a button with a clear visual
// state (available / selected / reserved / yours / managed) plus a text
// legend, so status is never communicated by color alone.
import { useMemo } from 'react';
import { seatLabel } from '../api.js';

export const SEAT_STATE = {
  available: 'available',
  selected: 'selected',
  reserved: 'reserved',
  mine: 'mine',
  managed: 'managed', // seat of the reservation currently being managed
};

function stateOf(seat, { selectedIds, mySeatIds, managedSeatIds }) {
  if (managedSeatIds?.has(seat.id)) return SEAT_STATE.managed;
  if (selectedIds?.has(seat.id)) return SEAT_STATE.selected;
  if (mySeatIds?.has(seat.id)) return SEAT_STATE.mine;
  if (seat.reserved) return SEAT_STATE.reserved;
  return SEAT_STATE.available;
}

const STATE_TEXT = {
  [SEAT_STATE.available]: 'Available',
  [SEAT_STATE.selected]: 'Selected by you',
  [SEAT_STATE.reserved]: 'Reserved',
  [SEAT_STATE.mine]: 'Reserved by you',
  [SEAT_STATE.managed]: 'In reservation being managed',
};

export default function SeatMap({ seats, selectedIds, mySeatIds, managedSeatIds, onSeatClick }) {
  const rows = useMemo(() => {
    const map = new Map();
    for (const seat of seats) {
      if (!map.has(seat.row)) map.set(seat.row, []);
      map.get(seat.row).push(seat);
    }
    return [...map.entries()];
  }, [seats]);

  const premiumRows = useMemo(() => {
    const set = new Set();
    for (const [, rowSeats] of rows) {
      if (rowSeats.every((seat) => seat.category === 'premium')) set.add(rowSeats[0].row);
    }
    return set;
  }, [rows]);

  function handleClick(seat) {
    if (!onSeatClick) return;
    onSeatClick(seat);
  }

  return (
    <div className="seatmap" role="group" aria-label="Theater seat map">
      <div className="screen" aria-hidden="true">SCREEN</div>

      {rows.map(([row, rowSeats]) => (
        <div className="seat-row" key={row}>
          <span className="row-label">
            Row {row}
            {premiumRows.has(row) && <span className="category-badge">Premium</span>}
            {!premiumRows.has(row) && <span className="category-badge category-normal">Standard</span>}
          </span>
          <div className="seat-row-seats">
            {rowSeats.map((seat) => {
              const state = stateOf(seat, { selectedIds, mySeatIds, managedSeatIds });
              const actionable =
                onSeatClick !== undefined &&
                (state === SEAT_STATE.available || state === SEAT_STATE.selected || state === SEAT_STATE.managed);
              return (
                <button
                  key={seat.id}
                  type="button"
                  className={`seat seat-${state}${actionable ? ' seat-actionable' : ''}`}
                  aria-label={`Seat ${seatLabel(seat)}, ${seat.category}, ${STATE_TEXT[state]}`}
                  aria-pressed={state === SEAT_STATE.selected ? 'true' : 'false'}
                  title={`${seatLabel(seat)} — ${STATE_TEXT[state]}`}
                  disabled={!actionable}
                  onClick={() => handleClick(seat)}
                >
                  {seat.number}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="legend" aria-label="Seat status legend">
        {[
          [SEAT_STATE.available, 'Available'],
          [SEAT_STATE.selected, 'Selected'],
          [SEAT_STATE.reserved, 'Reserved (others)'],
          [SEAT_STATE.mine, 'Yours'],
          [SEAT_STATE.managed, 'Managed reservation'],
        ].map(([state, text]) => (
          <span className="legend-item" key={state}>
            <span className={`seat seat-${state} legend-swatch`} aria-hidden="true" />
            <span className="legend-text">{text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// "What is the use of a book without pictures or conversations?" — Alice in Wonderland
