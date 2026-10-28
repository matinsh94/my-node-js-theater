// Login page: username + password, with an explicit Regular/Admin mode
// choice. Admin mode continues to a TOTP verification step.
import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

export default function LoginPage() {
  const { login, verifyTotp, authenticated, awaitingTotp } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('user');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password, mode);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTotp(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(totpCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (authenticated) {
    return (
      <div className="page narrow">
        <h1>Already logged in</h1>
        <p>You are logged in. Use the navigation above to reach the theater or your reservations.</p>
      </div>
    );
  }

  if (awaitingTotp) {
    return (
      <div className="page narrow">
        <h1>Two-factor verification</h1>
        <p className="muted">
          Enter the 6-digit code from your authenticator app to finish logging in as an admin.
        </p>
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <form onSubmit={handleTotp} className="panel form-panel">
          <label className="field">
            TOTP code
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || totpCode.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and log in'}
          </button>
        </form>
        <p className="hint">
          Development tip: run <code>npm run totp</code> inside <code>server/</code> to print a current code.
        </p>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1>Log in</h1>
      <p className="muted">Reserve seats and manage your reservations. Admins get extra powers.</p>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} className="panel form-panel">
        <label className="field">
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <fieldset className="field mode-field">
          <legend>Log in as</legend>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              value="user"
              checked={mode === 'user'}
              onChange={() => setMode('user')}
            />
            Regular user
          </label>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              value="admin"
              checked={mode === 'admin'}
              onChange={() => setMode('admin')}
            />
            Admin (requires TOTP)
          </label>
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Logging in…' : mode === 'admin' ? 'Continue to TOTP' : 'Log in'}
        </button>
      </form>

      <details className="panel test-accounts">
        <summary>Test accounts</summary>
        <table>
          <tbody>
            <tr><td>admin1</td><td>Admin1!Pass</td><td>admin-capable</td></tr>
            <tr><td>admin2</td><td>Admin2!Pass</td><td>admin-capable</td></tr>
            <tr><td>user1</td><td>User1!Pass</td><td>regular</td></tr>
            <tr><td>user2</td><td>User2!Pass</td><td>regular</td></tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}

// "It's always tea-time here." — the March Hare, Alice in Wonderland
