// App shell: header with navigation, active-role indicator and logout, plus
// a banner area and page content. All navigation is SPA-based (react-router).
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Layout() {
  const { loading, authenticated, user, role, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <span aria-hidden="true">🎩</span> Wonderland Theater
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/" end>
            Theater
          </NavLink>
          {authenticated && (
            <NavLink to="/reservations">My Reservations</NavLink>
          )}
          {authenticated && role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="session-box">
          {loading ? (
            <span className="muted">Checking session…</span>
          ) : authenticated ? (
            <>
              <span className={`role-pill role-${role}`}>{role === 'admin' ? 'Admin' : 'User'}</span>
              <span className="username">{user?.username}</span>
              <button type="button" className="btn btn-small" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-small btn-primary">
              Log in
            </Link>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span className="muted">A tiny theater, a curiouser seat map. Reserve politely.</span>
      </footer>
    </div>
  );
}

// "Everything is funny, if you can laugh at it." — Lewis Carroll, Alice in Wonderland
