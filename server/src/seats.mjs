// Public theater layout endpoint: the seat map is visible to everyone,
// logged in or not.
import express from 'express';
import { getAllSeats } from './db.mjs';

export function createSeatsRouter(db) {
  const router = express.Router();

  // GET /api/seats — every seat with its current availability status.
  router.get('/', (req, res) => {
    const seats = getAllSeats(db).map((seat) => ({
      id: seat.id,
      row: seat.row,
      number: seat.number,
      category: seat.category,
      reserved: seat.reservation_id !== null,
    }));
    res.json({ success: true, data: { seats, generatedAt: Date.now() } });
  });

  return router;
}

// "Oh dear! Oh dear! I shall be late!" — the White Rabbit, Alice in Wonderland
