import { useEffect, useState, type FormEvent } from 'react';
import type { AdminShopDTO } from '@barber/shared-types';
import { api, errorMessage } from './api';
import { useToast } from './components/Toast';
import { Button, Card, Empty, Field, Input, Spinner } from './components/ui';

export function ShopsPage() {
  const toast = useToast();
  const [shops, setShops] = useState<AdminShopDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Africa/Algiers');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    void api<{ shops: AdminShopDTO[] }>('/admin/shops')
      .then((r) => setShops(r.shops))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createShop = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api('/admin/shops', {
        method: 'POST',
        body: { slug, name, timezone, ownerName, ownerEmail, ownerPassword },
      });
      toast('Shop created', 'success');
      setSlug('');
      setName('');
      setOwnerName('');
      setOwnerEmail('');
      setOwnerPassword('');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (s: AdminShopDTO) => {
    setBusyId(s.id);
    try {
      await api(`/admin/shops/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
      toast(s.isActive ? 'Shop deactivated' : 'Shop activated', 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Shops</h1>
        <p>Every barbershop on the platform. Create a shop with its first owner, or deactivate one.</p>
      </div>

      <div className="stack">
        <Card>
          <div className="card-head">
            <div>
              <h2>New shop</h2>
              <p>Creates the shop and its first owner account in one step.</p>
            </div>
          </div>
          <form className="card-pad grid-2" onSubmit={createShop}>
            <Field label="Slug (subdomain)">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="oran-fades" spellCheck={false} required />
            </Field>
            <Field label="Shop name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Oran Fades" required />
            </Field>
            <Field label="Timezone">
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
            <Field label="Owner name">
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Sami Hadj" required />
            </Field>
            <Field label="Owner email">
              <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@oran-fades.dz" required />
            </Field>
            <Field label="Owner password">
              <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} placeholder="min 8 characters" required />
            </Field>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create shop'}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <div className="card-head">
            <div>
              <h2>All shops</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={load}>
              Refresh
            </Button>
          </div>
          {loading ? (
            <Spinner />
          ) : shops.length === 0 ? (
            <Empty>No shops yet — create one above.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Timezone</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-strong">{s.slug}</td>
                    <td className="cell-muted">{s.name ?? '—'}</td>
                    <td className="cell-muted">{s.ownerEmail ?? '—'}</td>
                    <td className="cell-muted">{s.timezone}</td>
                    <td>
                      <span className={`badge badge-${s.isActive ? 'completed' : 'cancelled'}`}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={s.isActive ? 'danger' : 'ghost'}
                        disabled={busyId === s.id}
                        onClick={() => void toggleActive(s)}
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
