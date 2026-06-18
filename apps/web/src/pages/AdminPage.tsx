import { useEffect, useState, type FormEvent } from 'react';
import type { ServiceDTO, BarberDTO, WorkingHourDTO, TimeOffDTO } from '@barber/shared-types';
import { api, errorMessage } from '../api';
import { useAuth, type Principal } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner } from '../components/ui';
import { WEEKDAYS, fmtDateTime, hhmmToMinutes, minutesToHHMM, serviceLabel } from '../util';

type Tab = 'services' | 'hours' | 'timeoff';

export function AdminPage() {
  const { principal } = useAuth();
  const [tab, setTab] = useState<Tab>(principal?.kind === 'owner' ? 'services' : 'hours');
  const [barbers, setBarbers] = useState<BarberDTO[]>([]);

  useEffect(() => {
    void api<{ barbers: BarberDTO[] }>('/api/barbers')
      .then((r) => setBarbers(r.barbers))
      .catch(() => setBarbers([]));
  }, []);

  if (!principal) return null;

  const tabBtn = (key: Tab, label: string) => (
    <button className={`btn ${tab === key ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setTab(key)}>
      {label}
    </button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Admin</h1>
        <p>Manage your shop’s services, schedules and time off.</p>
      </div>

      <div className="row-wrap" style={{ marginBottom: 18 }}>
        {principal.kind === 'owner' ? tabBtn('services', 'Services') : null}
        {tabBtn('hours', 'Working hours')}
        {tabBtn('timeoff', 'Time off')}
      </div>

      {tab === 'services' ? <ServicesAdmin /> : null}
      {tab === 'hours' ? <HoursAdmin principal={principal} barbers={barbers} /> : null}
      {tab === 'timeoff' ? <TimeOffAdmin principal={principal} barbers={barbers} /> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Services */

function ServicesAdmin() {
  const toast = useToast();
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [durationMin, setDurationMin] = useState('30');
  const [priceDzd, setPriceDzd] = useState('500');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    void api<{ services: ServiceDTO[] }>('/api/services/all?includeInactive=true')
      .then((r) => setServices(r.services))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/services', {
        method: 'POST',
        body: {
          nameAr,
          nameEn: nameEn || null,
          durationMin: Number(durationMin),
          priceDzd: Number(priceDzd),
        },
      });
      toast('Service created', 'success');
      setNameAr('');
      setNameEn('');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: ServiceDTO) => {
    try {
      await api(`/api/services/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (s: ServiceDTO) => {
    try {
      await api(`/api/services/${s.id}`, { method: 'DELETE' });
      toast('Service removed', 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="card-head">
          <div>
            <h2>Add a service</h2>
            <p>Shop-wide — any barber can perform it.</p>
          </div>
        </div>
        <form className="card-pad grid-2" onSubmit={create}>
          <Field label="Name (Arabic)">
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="قص شعر" required />
          </Field>
          <Field label="Name (English, optional)">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Haircut" />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min={5}
              max={480}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </Field>
          <Field label="Price (DZD)">
            <Input type="number" min={0} value={priceDzd} onChange={(e) => setPriceDzd(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add service'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h2>Services</h2>
          </div>
        </div>
        {loading ? (
          <Spinner />
        ) : services.length === 0 ? (
          <Empty>No services yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Duration</th>
                <th>Price</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td className="cell-strong">
                    {serviceLabel(s)}
                    {s.nameEn ? <span className="cell-muted"> · {s.nameAr}</span> : null}
                  </td>
                  <td>{s.durationMin} min</td>
                  <td>{s.priceDzd} DZD</td>
                  <td>
                    <Badge status={s.isActive ? 'confirmed' : 'cancelled'} />
                  </td>
                  <td>
                    <div className="row-wrap">
                      <Button size="sm" variant="ghost" onClick={() => void toggle(s)}>
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      {s.isActive ? (
                        <Button size="sm" variant="danger" onClick={() => void remove(s)}>
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ Barber picker */

function BarberPicker({
  principal,
  barbers,
  value,
  onChange,
}: {
  principal: Principal;
  barbers: BarberDTO[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (principal.kind === 'barber') {
    return (
      <Field label="Barber">
        <Input value={principal.name} disabled />
      </Field>
    );
  }
  return (
    <Field label="Barber">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a barber…</option>
        {barbers.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nameEn ?? b.nameAr}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* ------------------------------------------------------------ Working hours */

type DayShifts = Record<number, Array<{ start: string; end: string }>>;
const emptyDays = (): DayShifts => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

function HoursAdmin({ principal, barbers }: { principal: Principal; barbers: BarberDTO[] }) {
  const toast = useToast();
  const [barberId, setBarberId] = useState(principal.kind === 'barber' ? principal.id : '');
  const [days, setDays] = useState<DayShifts>(emptyDays());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!barberId) {
      setDays(emptyDays());
      return;
    }
    setLoading(true);
    void api<{ workingHours: WorkingHourDTO[] }>(`/api/working-hours/barbers/${barberId}`)
      .then((r) => {
        const next = emptyDays();
        for (const wh of r.workingHours) {
          next[wh.weekday]!.push({ start: minutesToHHMM(wh.startMin), end: minutesToHHMM(wh.endMin) });
        }
        setDays(next);
      })
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [barberId, toast]);

  const addShift = (wd: number) =>
    setDays((d) => ({ ...d, [wd]: [...d[wd]!, { start: '09:00', end: '17:00' }] }));
  const removeShift = (wd: number, idx: number) =>
    setDays((d) => ({ ...d, [wd]: d[wd]!.filter((_, i) => i !== idx) }));
  const editShift = (wd: number, idx: number, key: 'start' | 'end', val: string) =>
    setDays((d) => ({ ...d, [wd]: d[wd]!.map((s, i) => (i === idx ? { ...s, [key]: val } : s)) }));

  const save = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(days).flatMap(([wd, shifts]) =>
        shifts.map((s) => ({
          weekday: Number(wd),
          startMin: hhmmToMinutes(s.start),
          endMin: hhmmToMinutes(s.end),
        })),
      );
      await api(`/api/working-hours/barbers/${barberId}`, { method: 'PUT', body: { entries } });
      toast('Working hours saved', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="card-pad">
          <BarberPicker principal={principal} barbers={barbers} value={barberId} onChange={setBarberId} />
        </div>
      </Card>

      {!barberId ? (
        <Empty>Choose a barber to edit their weekly hours.</Empty>
      ) : loading ? (
        <Spinner />
      ) : (
        <Card>
          <div className="card-head">
            <div>
              <h2>Weekly hours</h2>
              <p>Add multiple shifts per day for a midday break.</p>
            </div>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <div className="card-pad stack">
            {WEEKDAYS.map((label, wd) => (
              <div key={wd} className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 96, paddingTop: 8, fontWeight: 500 }}>{label}</div>
                <div className="stack" style={{ flex: 1 }}>
                  {days[wd]!.length === 0 ? <span className="hint">Closed</span> : null}
                  {days[wd]!.map((s, idx) => (
                    <div className="row" key={idx}>
                      <Input
                        type="time"
                        value={s.start}
                        onChange={(e) => editShift(wd, idx, 'start', e.target.value)}
                        style={{ width: 130 }}
                      />
                      <span className="muted">to</span>
                      <Input
                        type="time"
                        value={s.end}
                        onChange={(e) => editShift(wd, idx, 'end', e.target.value)}
                        style={{ width: 130 }}
                      />
                      <Button size="sm" variant="danger" onClick={() => removeShift(wd, idx)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => addShift(wd)}>
                      + Add shift
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Time off */

function TimeOffAdmin({ principal, barbers }: { principal: Principal; barbers: BarberDTO[] }) {
  const toast = useToast();
  const [tz, setTz] = useState('Africa/Algiers');
  const [barberId, setBarberId] = useState(principal.kind === 'barber' ? principal.id : '');
  const [items, setItems] = useState<TimeOffDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ shop: { timezone: string } }>('/api/shop')
      .then((r) => setTz(r.shop.timezone))
      .catch(() => undefined);
  }, []);

  const load = (id: string) => {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    void api<{ timeOff: TimeOffDTO[] }>(`/api/time-off/barbers/${id}`)
      .then((r) => setItems(r.timeOff))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(barberId), [barberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!barberId || !start || !end) return;
    setBusy(true);
    try {
      await api(`/api/time-off/barbers/${barberId}`, {
        method: 'POST',
        body: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          reason: reason || undefined,
        },
      });
      toast('Time off added', 'success');
      setStart('');
      setEnd('');
      setReason('');
      load(barberId);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/time-off/${id}`, { method: 'DELETE' });
      toast('Time off removed', 'success');
      load(barberId);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="card-pad">
          <BarberPicker principal={principal} barbers={barbers} value={barberId} onChange={setBarberId} />
        </div>
      </Card>

      {!barberId ? (
        <Empty>Choose a barber to manage their time off.</Empty>
      ) : (
        <>
          <Card>
            <div className="card-head">
              <div>
                <h2>Add time off</h2>
                <p>Times are in your browser’s local timezone.</p>
              </div>
            </div>
            <form className="card-pad grid-2" onSubmit={add}>
              <Field label="From">
                <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              </Field>
              <Field label="To">
                <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
              <Field label="Reason (optional)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation" />
              </Field>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Adding…' : 'Add time off'}
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h2>Scheduled time off</h2>
              </div>
            </div>
            {loading ? (
              <Spinner />
            ) : items.length === 0 ? (
              <Empty>No time off scheduled.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td className="cell-strong">{fmtDateTime(t.start, tz)}</td>
                      <td>{fmtDateTime(t.end, tz)}</td>
                      <td className="cell-muted">{t.reason ?? '—'}</td>
                      <td>
                        <Button size="sm" variant="danger" onClick={() => void remove(t.id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
