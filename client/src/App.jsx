// Root component: routing table + auth provider + layout.
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import TheaterPage from './pages/TheaterPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ReservationsPage from './pages/ReservationsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TheaterPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

// "There is no use trying," said Alice; "one can't believe impossible things." — Alice in Wonderland
