import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { AuthProvider, useAuth } from './AuthContext';
import { PublicLayout } from './PublicLayout';
import { BusinessLayout } from './BusinessLayout';
import { BookPage } from '../pages/BookPage';
import { ShopNotFound } from '../pages/ShopNotFound';
import { LandingPage } from '../pages/LandingPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { Spinner } from '../components/ui';
import { getShopSlug } from '../api';

// One build serves every shop. The shop is resolved from the hostname (see api.ts);
// until it's resolved we show a spinner, and if it maps to no active shop we show
// ShopNotFound instead of a broken booking page.
function AppRoutes() {
  const { shop, loading } = useAuth();
  if (loading) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }
  return (
    <Routes>
      {/* Password reset links from email land on the apex — this route must work
          with or without a resolved shop. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {shop ? (
        <>
          {/* Public customer site — no staff/admin affordance. */}
          <Route path="/" element={<PublicLayout />}>
            <Route index element={<BookPage />} />
          </Route>

          {/* Business portal — owner/barber login + staff console. */}
          <Route path="/business" element={<BusinessLayout />} />

          {/* Unknown paths fall back to the public site. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        /* No shop resolved. A hostname that ADDRESSES a shop (slug present but
           unknown/inactive) gets the not-found page; the bare apex / reserved
           subdomains (www) are the platform's front door → landing page. */
        <Route path="*" element={getShopSlug() ? <ShopNotFound /> : <LandingPage />} />
      )}
    </Routes>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}
