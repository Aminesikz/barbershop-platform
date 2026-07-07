import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input } from '../components/ui';

type Role = 'owner' | 'barber';

/**
 * Where to send an owner after a successful reset. The reset link lands on the
 * apex (no shop subdomain), so rebuild the shop console URL from the slug the
 * API returns. On localhost there are no subdomains — stay on this host.
 */
function shopConsoleUrl(slug: string): string {
  const { protocol, hostname } = window.location;
  const parts = hostname.split('.');
  const base = parts.length >= 3 ? parts.slice(1).join('.') : hostname;
  if (base === 'localhost' || hostname === 'localhost') return '/business';
  return `${protocol}//${slug}.${base}/business`;
}

/** Request form: ask for the account email, always answered generically. */
function ForgotForm({ initialRole }: { initialRole: Role }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/auth/${role}/forgot-password`, { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="card-pad stack">
        <h2>Check your email</h2>
        <p className="muted">
          If <strong>{email}</strong> has an account, a reset link is on its way. The link expires
          in 30 minutes — check your spam folder if you don't see it.
        </p>
      </div>
    );
  }

  return (
    <div className="card-pad stack">
      <div className="seg-group" role="tablist">
        <button className={`seg ${role === 'owner' ? 'active' : ''}`} onClick={() => setRole('owner')}>
          Owner
        </button>
        <button className={`seg ${role === 'barber' ? 'active' : ''}`} onClick={() => setRole('barber')}>
          Barber
        </button>
      </div>
      <form className="stack" onSubmit={submit}>
        <Field label="Account email">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </div>
  );
}

/** Reset form: shown when the emailed link (with ?token=) is opened. */
function ResetForm({ role, token }: { role: Role; token: string }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [shopSlug, setShopSlug] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast('Passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ shopSlug: string | null }>(`/auth/${role}/reset-password`, {
        method: 'POST',
        body: { token, password },
      });
      setShopSlug(res.shopSlug);
      setDone(true);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card-pad stack">
        <h2>Password updated</h2>
        <p className="muted">You can sign in with your new password now.</p>
        {shopSlug ? (
          <a className="btn btn-primary" href={shopConsoleUrl(shopSlug)}>
            Go to your console
          </a>
        ) : (
          <p className="muted">Open your shop's page and sign in from the business portal.</p>
        )}
      </div>
    );
  }

  return (
    <div className="card-pad stack">
      <form className="stack" onSubmit={submit}>
        <Field label="New password">
          <Input
            type="password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </div>
  );
}

/**
 * /reset-password — reachable on ANY host (apex included): reset links land here
 * from email, so this page must not depend on a resolved shop.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const role: Role = params.get('kind') === 'barber' ? 'barber' : 'owner';

  return (
    <div className="page">
      <div className="page-head">
        <h1>{token ? 'Choose a new password' : 'Forgot your password?'}</h1>
        <p>{token ? 'Enter a new password for your account.' : "We'll email you a reset link."}</p>
      </div>
      <Card>{token ? <ResetForm role={role} token={token} /> : <ForgotForm initialRole={role} />}</Card>
    </div>
  );
}
