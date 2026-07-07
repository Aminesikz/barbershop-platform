import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { AuthProvider, useAuth } from './AuthContext';
import { PublicLayout } from './PublicLayout';
import { BusinessLayout } from './BusinessLayout';
import { BookPage } from '../pages/BookPage';
import { ShopNotFound } from '../pages/ShopNotFound';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { Spinner } from '../components/ui';

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
        <Route path="*" element={<ShopNotFound />} />
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
