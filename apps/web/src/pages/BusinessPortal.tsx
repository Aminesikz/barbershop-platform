import { useState, type FormEvent } from 'react';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { errorMessage, getShopSlug } from '../api';
import { titleCase } from '../util';
import { Button, Card, Field, Input } from '../components/ui';
import { BUSINESS_PITCH, DEVELOPER_CONTACT } from '../content';

type Role = 'owner' | 'barber';

const DEMO: Record<Role, { email: string; password: string }> = {
  owner: { email: 'owner@algiers-cuts.dz', password: 'OwnerPass123!' },
  barber: { email: 'barber@algiers-cuts.dz', password: 'BarberPass123!' },
};

export function BusinessPortal() {
  const { loginOwner, loginBarber } = useAuth();
  const toast = useToast();

  const [role, setRole] = useState<Role>('owner');
  const [email, setEmail] = useState(DEMO.owner.email);
  const [password, setPassword] = useState(DEMO.owner.password);
  const [busy, setBusy] = useState(false);

  const shopName = titleCase(getShopSlug());

  const switchRole = (r: Role) => {
    setRole(r);
    setEmail(DEMO[r].email);
    setPassword(DEMO[r].password);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (role === 'owner') await loginOwner(email, password);
      else await loginBarber(email, password);
      toast(`Signed in as ${role}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const phoneHref = `tel:${DEVELOPER_CONTACT.phone.replace(/[\s]/g, '')}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Business sign in</h1>
        <p>
          Owners and barbers — manage <strong>{shopName}</strong>: bookings, services and schedule.
        </p>
      </div>

      <Card>
        <div className="card-pad stack">
          <div className="seg-group" role="tablist">
            <button className={`seg ${role === 'owner' ? 'active' : ''}`} onClick={() => switchRole('owner')}>
              Owner
            </button>
            <button className={`seg ${role === 'barber' ? 'active' : ''}`} onClick={() => switchRole('barber')}>
              Barber
            </button>
          </div>

          <form className="stack" onSubmit={submit}>
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
              {busy ? 'Signing in…' : `Sign in as ${role}`}
            </Button>
          </form>
        </div>
      </Card>

      {/* Software pitch + developer contact */}
      <section className="section pitch">
        <div className="section-eyebrow">{BUSINESS_PITCH.eyebrow}</div>
        <h2 className="section-title">{BUSINESS_PITCH.headline}</h2>
        <p className="muted" style={{ maxWidth: 580 }}>
          {BUSINESS_PITCH.body}
        </p>
        <div className="row-wrap" style={{ marginTop: 16 }}>
          <a className="btn btn-primary" href={`mailto:${DEVELOPER_CONTACT.email}`}>
            ✉&nbsp; {DEVELOPER_CONTACT.email}
          </a>
          <a className="btn btn-ghost" href={phoneHref}>
            ☎&nbsp; {DEVELOPER_CONTACT.phone}
          </a>
        </div>
      </section>
    </div>
  );
}
