// Server entry point: starts the API on port 3000.
// Run with "nodemon index.mjs" (npm run dev) or "node index.mjs".
import { createApp } from './src/app.mjs';

const PORT = Number(process.env.PORT || 3000);

const { app } = createApp();

app.listen(PORT, () => {
  console.log(`Theater reservation API listening on http://localhost:${PORT}`);
  console.log('CORS enabled for the Vite dev origin http://localhost:5173 (credentials: on)');
});

// "If you don't know where you are going, any road can take you there." — Alice in Wonderland
