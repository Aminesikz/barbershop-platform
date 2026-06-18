import { useState, type FormEvent } from 'react';
import { ToastProvider, useToast } from './components/Toast';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthContext';
import { errorMessage } from './api';
import { Button, Card, Field, Input, Spinner } from './components/ui';
import { ShopsPage } from './ShopsPage';

function AdminLogin() {
  const { login } = useAdminAuth();
  const toast = useToast();
  const [email, setEmail] = useState('admin@platform.dz');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast('Signed in', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="page-head">
        <h1>Platform Admin</h1>
        <p>Restricted area. Sign in to manage shops.</p>
      </div>
      <Card>
        <form className="card-pad stack" onSubmit={submit}>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Shell() {
  const { admin, loading, logout } = useAdminAuth();

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" /> Platform Admin
        </div>
        <div className="header-right">
          {admin ? (
            <>
              <span className="who">
                <strong>{admin.name}</strong>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                Log out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main>{loading ? <Spinner /> : admin ? <ShopsPage /> : <AdminLogin />}</main>
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AdminAuthProvider>
        <Shell />
      </AdminAuthProvider>
    </ToastProvider>
  );
}
