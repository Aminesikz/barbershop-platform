import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookingDTO, ServiceDTO, BarberDTO, BookingStatus } from '@barber/shared-types';
import { api, errorMessage, getBarberToken, wsUrl } from '../api';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Empty, Select, Spinner } from '../components/ui';
import { fmtDateTime, serviceLabel } from '../util';

const STATUSES: Array<BookingStatus | 'all'> = [
  'all',
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

function actionsFor(status: BookingStatus): Array<{ action: string; label: string; variant: 'primary' | 'ghost' | 'danger' }> {
  switch (status) {
    case 'pending':
      return [
        { action: 'confirm', label: 'Confirm', variant: 'primary' },
        { action: 'cancel', label: 'Cancel', variant: 'danger' },
      ];
    case 'confirmed':
      return [
        { action: 'complete', label: 'Complete', variant: 'ghost' },
        { action: 'no-show', label: 'No-show', variant: 'ghost' },
        { action: 'cancel', label: 'Cancel', variant: 'danger' },
      ];
    default:
      return [];
  }
}

export function BookingsPage() {
  const { principal } = useAuth();
  const toast = useToast();
  const [tz, setTz] = useState('Africa/Algiers');
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [services, setServices] = useState<Record<string, ServiceDTO>>({});
  const [barbers, setBarbers] = useState<Record<string, BarberDTO>>({});
  const [status, setStatus] = useState<BookingStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const q = status === 'all' ? '' : `?status=${status}`;
        const r = await api<{ bookings: BookingDTO[] }>(`/api/bookings${q}`);
        setBookings(r.bookings);
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        setLoading(false);
      }
    },
    [status, toast],
  );

  // Static metadata for name lookups + shop tz.
  useEffect(() => {
    void (async () => {
      try {
        const [shop, svc, brb] = await Promise.all([
          api<{ shop: { timezone: string } }>('/api/shop'),
          api<{ services: ServiceDTO[] }>('/api/services'),
          api<{ barbers: BarberDTO[] }>('/api/barbers'),
        ]);
        setTz(shop.shop.timezone);
        setServices(Object.fromEntries(svc.services.map((s) => [s.id, s])));
        setBarbers(Object.fromEntries(brb.barbers.map((b) => [b.id, b])));
      } catch {
        /* non-fatal — names just fall back to ids */
      }
    })();
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Live updates over WebSocket (barber JWT only — the handshake requires a barber token).
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    const token = getBarberToken();
    if (!principal || principal.kind !== 'barber' || !token) return;
    const url = wsUrl(`token=${encodeURIComponent(token)}&shopId=${encodeURIComponent(principal.shopId)}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type?: string };
        if (msg.type === 'BOOKING_CREATED') {
          toast('New booking came in', 'info');
          void load();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [principal, load, toast]);

  const act = async (id: string, action: string) => {
    setBusyId(id);
    try {
      await api(`/api/bookings/${id}/${action}`, {
        method: 'PATCH',
        ...(action === 'cancel' ? { body: {} } : {}),
      });
      toast(`Booking ${action === 'no-show' ? 'marked no-show' : `${action}ed`}`, 'success');
      await load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const serviceName = (id: string) => {
    const s = services[id];
    return s ? serviceLabel(s) : id.slice(0, 8);
  };
  const barberName = (id: string) => {
    const b = barbers[id];
    return b ? b.nameEn ?? b.nameAr : id.slice(0, 8);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Bookings</h1>
        <p>
          {principal?.kind === 'barber'
            ? 'Your bookings.'
            : 'All bookings for this shop.'}
        </p>
      </div>

      <Card>
        <div className="card-head">
          <div className="row">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as BookingStatus | 'all')}
              style={{ width: 160 }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div className="row">
            {live ? <span className="live-dot">Live</span> : null}
            <Button variant="ghost" size="sm" onClick={() => void load(true)}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : bookings.length === 0 ? (
          <Empty>No bookings{status === 'all' ? ' yet' : ` with status “${status}”`}.</Empty>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Service</th>
                <th>Barber</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="cell-strong">{fmtDateTime(b.start, tz)}</td>
                  <td>
                    <div className="cell-strong">{b.customerName}</div>
                    <div className="cell-muted">{b.customerPhone}</div>
                    {b.customerEmail ? <div className="cell-muted">{b.customerEmail}</div> : null}
                  </td>
                  <td>{serviceName(b.serviceId)}</td>
                  <td>{barberName(b.barberId)}</td>
                  <td>
                    <Badge status={b.status} />
                    {b.cancelReason ? <div className="cell-muted">{b.cancelReason}</div> : null}
                  </td>
                  <td>
                    <div className="row-wrap">
                      {actionsFor(b.status).map((a) => (
                        <Button
                          key={a.action}
                          size="sm"
                          variant={a.variant}
                          disabled={busyId === b.id}
                          onClick={() => void act(b.id, a.action)}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {principal?.kind === 'owner' ? (
        <p className="hint" style={{ marginTop: 12 }}>
          Live updates stream to barber sessions (the WebSocket handshake authenticates with a
          barber token). Log in as the barber to see bookings appear in real time.
        </p>
      ) : null}
    </div>
  );
}
