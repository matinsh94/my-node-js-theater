// Authentication context: holds the session status fetched from the server
// and exposes login / TOTP verification / logout actions to the whole app.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState({ loading: true, authenticated: false, awaitingTotp: false });

  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/status');
      if (data.awaitingTotp) {
        setStatus({ loading: false, authenticated: false, awaitingTotp: true });
      } else if (data.authenticated) {
        setStatus({ loading: false, authenticated: true, awaitingTotp: false, user: data.user, role: data.role });
      } else {
        setStatus({ loading: false, authenticated: false, awaitingTotp: false });
      }
    } catch {
      setStatus({ loading: false, authenticated: false, awaitingTotp: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (username, password, mode) => {
      const data = await api('/auth/login', { method: 'POST', body: { username, password, mode } });
      if (data.requiresTotp) {
        setStatus({ loading: false, authenticated: false, awaitingTotp: true });
      } else {
        await refresh();
      }
      return data;
    },
    [refresh]
  );

  const verifyTotp = useCallback(
    async (code) => {
      const data = await api('/auth/totp', { method: 'POST', body: { code } });
      await refresh();
      return data;
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setStatus({ loading: false, authenticated: false, awaitingTotp: false });
  }, []);

  const value = useMemo(() => ({ ...status, refresh, login, verifyTotp, logout }), [status, refresh, login, verifyTotp, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

// "I can't explain myself, I'm afraid, sir, because I'm not myself, you see." — Alice in Wonderland
