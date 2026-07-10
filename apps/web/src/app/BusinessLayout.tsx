import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '../components/ui';
import { BusinessPortal } from '../pages/BusinessPortal';
import { BookingsPage } from '../pages/BookingsPage';
import { AdminPage } from '../pages/AdminPage';

type Tab = 'bookings' | 'settings';

/**
 * Business portal shell. Logged out → BusinessPortal (login + software pitch).
 * Logged in → staff console (bookings + shop settings).
 */
export function BusinessLayout() {
  const { principal, loading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('bookings');

  return (
    <>
      <header className="app-header app-header-staff">
        <div className="brand">
          <span className="brand-dot" /> Business Console
        </div>
        {principal ? (
          <nav className="nav">
            <button className={tab === 'bookings' ? 'active' : ''} onClick={() => setTab('bookings')}>
              Bookings
            </button>
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
              Shop settings
            </button>
          </nav>
        ) : null}
        <div className="header-right">
          <Link to="/" className="btn btn-ghost btn-sm">
            View site
          </Link>
          {principal ? (
            <>
              <span className="who">
                <strong>{principal.name}</strong> · {principal.kind}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                Log out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main>
        {loading ? (
          <Spinner />
        ) : !principal ? (
          <BusinessPortal />
        ) : tab === 'bookings' ? (
          <BookingsPage />
        ) : (
          <AdminPage />
        )}
      </main>
    </>
  );
}
