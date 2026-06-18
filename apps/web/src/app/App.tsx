import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from './AuthContext';
import { PublicLayout } from './PublicLayout';
import { BusinessLayout } from './BusinessLayout';
import { BookPage } from '../pages/BookPage';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Public customer site — no staff/admin affordance. */}
          <Route path="/" element={<PublicLayout />}>
            <Route index element={<BookPage />} />
          </Route>

          {/* Business portal — owner/barber login + staff console. */}
          <Route path="/business" element={<BusinessLayout />} />

          {/* Unknown paths fall back to the public site. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
