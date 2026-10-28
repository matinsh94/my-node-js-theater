// Utility: prints the current TOTP code for the seeded admin secret, so the
// admin login can be tested without an authenticator app.
// Usage: npm run totp   (inside server/)
import speakeasy from 'speakeasy';
import { SEED_TOTP_SECRET } from '../src/seed.mjs';

const code = speakeasy.totp({
  secret: SEED_TOTP_SECRET,
  encoding: 'base32',
});

const remaining = speakeasy.totp.verify({
  secret: SEED_TOTP_SECRET,
  encoding: 'base32',
  token: code,
  window: 1,
})
  ? 30 - (Math.floor(Date.now() / 1000) % 30)
  : 0;

console.log(`Current TOTP code: ${code} (valid for about ${remaining}s)`);
console.log('Secret (base32):', SEED_TOTP_SECRET);

// "Twinkle, twinkle, little bat! How I wonder what you're at!" — Alice in Wonderland
