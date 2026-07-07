import { useEffect, useState } from 'react';
import type { ServiceDTO, BarberDTO, AvailabilityDTO, PublicBookingDTO } from '@barber/shared-types';
import { api, errorMessage } from '../api';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, Field, Input, Select, Spinner, Stars } from '../components/ui';
import { fmtTime, fmtDateTime, todayPlus, uuid, serviceLabel, titleCase } from '../util';
import { barberMeta, REVIEWS, HIGHLIGHTS } from '../content';

function scrollToBooking() {
  document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function BookPage() {
  const toast = useToast();
  const { shop } = useAuth();
  const shopName = shop?.name ?? titleCase(shop?.slug ?? '');
  const tz = shop?.timezone ?? 'Africa/Algiers';
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [barbers, setBarbers] = useState<BarberDTO[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [serviceId, setServiceId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [date, setDate] = useState(todayPlus(1));

  const [slots, setSlots] = useState<AvailabilityDTO['slots']>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicBookingDTO | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [svc, brb] = await Promise.all([
          api<{ services: ServiceDTO[] }>('/api/services'),
          api<{ barbers: BarberDTO[] }>('/api/barbers'),
        ]);
        setServices(svc.services);
        setBarbers(brb.barbers);
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [toast]);

  useEffect(() => {
    if (!serviceId || !barberId || !date) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    setSelected(null);
    const q = new URLSearchParams({ barberId, serviceId, date }).toString();
    void api<AvailabilityDTO>(`/api/availability?${q}`)
      .then((r) => setSlots(r.slots))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setSlotsLoading(false));
  }, [serviceId, barberId, date, toast]);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const r = await api<{ booking: PublicBookingDTO }>('/api/bookings', {
        method: 'POST',
        body: {
          barberId,
          serviceId,
          start: selected,
          customerName: name,
          customerPhone: phone,
          ...(email.trim() ? { customerEmail: email.trim() } : {}),
          idempotencyKey: uuid(),
        },
      });
      setResult(r.booking);
      toast('Booking confirmed', 'success');
      scrollToBooking();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setSelected(null);
    setName('');
    setPhone('');
    setEmail('');
  };

  const pickBarber = (id: string) => {
    setBarberId(id);
    scrollToBooking();
  };

  const canPickDetails = selected !== null;
  const canSubmit = canPickDetails && name.trim().length >= 2 && phone.trim().length > 0 && !submitting;

  return (
    <div className="page page-wide">
      {/* Hero */}
      <section className="hero">
        <div className="hero-eyebrow">★ Trusted by 500+ clients in Algiers</div>
        <h1 className="hero-title">{shopName}</h1>
        <p className="hero-sub">
          Sharp cuts, classic shaves, and a chair that’s always ready. Book your barber online in
          under a minute.
        </p>
        <div className="hero-meta">
          <span className="chip">Open Sun–Thu · 9am – 8pm</span>
          <span className="chip">
            <Stars value={5} small /> 4.9 · 320 reviews
          </span>
          <span className="chip">Walk-ins welcome</span>
        </div>
        <div style={{ marginTop: 22 }}>
          <Button className="btn-lg" onClick={scrollToBooking}>
            Book an appointment
          </Button>
        </div>
      </section>

      {/* Highlights */}
      <div className="highlights" style={{ marginTop: 18 }}>
        {HIGHLIGHTS.map((h) => (
          <div className="highlight" key={h.title}>
            <div className="ico">{h.icon}</div>
            <div>
              <h4>{h.title}</h4>
              <p>{h.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Booking */}
      <section className="section" id="book">
        <div className="section-eyebrow">Reserve your seat</div>
        <h2 className="section-title">Book your visit</h2>

        {loadingMeta ? (
          <Spinner />
        ) : result ? (
          <Card>
            <div className="card-pad stack">
              <div className="success-box">
                <strong>You’re booked.</strong> {serviceLabel(result.service)} with{' '}
                {result.barber.nameEn ?? result.barber.nameAr} — {fmtDateTime(result.start, tz)}.
              </div>
              <div className="hint">
                Status: {result.status}.{' '}
                {email.trim()
                  ? `A confirmation email is on its way to ${email.trim()}.`
                  : 'The shop will confirm your appointment shortly.'}
              </div>
              <div>
                <Button onClick={reset}>Book another</Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="stack">
            <Card>
              <div className="card-pad grid-2">
                <Field label="Service">
                  <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    <option value="">Choose a service…</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {serviceLabel(s)} · {s.durationMin} min · {s.priceDzd} DZD
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Barber">
                  <Select value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                    <option value="">Choose a barber…</option>
                    {barbers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nameEn ?? b.nameAr}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date">
                  <Input
                    type="date"
                    value={date}
                    min={todayPlus(0)}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
              </div>
            </Card>

            {serviceId && barberId && date ? (
              <Card>
                <div className="card-head">
                  <div>
                    <h2>Available times</h2>
                    <p>Shop time ({tz})</p>
                  </div>
                </div>
                <div className="card-pad">
                  {slotsLoading ? (
                    <Spinner />
                  ) : slots.length === 0 ? (
                    <div className="empty">No open slots for this day. Try another date or barber.</div>
                  ) : (
                    <div className="slot-grid">
                      {slots.map((s) => (
                        <button
                          key={s.start}
                          className={`slot ${selected === s.start ? 'selected' : ''}`}
                          onClick={() => setSelected(s.start)}
                        >
                          {fmtTime(s.start, tz)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ) : null}

            {canPickDetails ? (
              <Card>
                <div className="card-head">
                  <div>
                    <h2>Your details</h2>
                    <p>{selected ? fmtDateTime(selected, tz) : ''}</p>
                  </div>
                </div>
                <div className="card-pad grid-2">
                  <Field label="Full name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ali Mansouri" />
                  </Field>
                  <Field label="Phone (Algerian mobile)">
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0551234567" />
                  </Field>
                  <Field label="Email (optional — for your confirmation)">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </Field>
                </div>
                <div className="card-pad" style={{ paddingTop: 0 }}>
                  <Button onClick={() => void submit()} disabled={!canSubmit}>
                    {submitting ? 'Booking…' : 'Confirm booking'}
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      {/* Barbers / about */}
      {barbers.length > 0 ? (
        <section className="section">
          <div className="section-eyebrow">The team</div>
          <h2 className="section-title">Meet our barbers</h2>
          <div className="barber-grid">
            {barbers.map((b, i) => {
              const m = barberMeta(i);
              const display = b.nameEn ?? b.nameAr;
              return (
                <div className="barber-card" key={b.id}>
                  <div className="barber-top">
                    <Avatar name={display} />
                    <div>
                      <div className="barber-name">{display}</div>
                      <div className="barber-role">{m.role}</div>
                    </div>
                  </div>
                  <p className="barber-bio">{m.bio}</p>
                  <div className="rating-line">
                    <Stars value={m.rating} small /> {m.rating.toFixed(1)} · {m.reviews} reviews
                  </div>
                  <div className="barber-foot">
                    <span className="barber-specialty">{m.specialty}</span>
                    <Button size="sm" variant="ghost" onClick={() => pickBarber(b.id)}>
                      Book
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Reviews */}
      <section className="section">
        <div className="section-eyebrow">Reviews</div>
        <h2 className="section-title">What our clients say</h2>
        <div className="reviews-grid">
          {REVIEWS.map((r) => (
            <div className="review-card" key={r.name}>
              <Stars value={r.rating} />
              <p className="review-quote">“{r.text}”</p>
              <div className="review-author">
                <Avatar name={r.name} />
                <div>
                  <div className="nm">{r.name}</div>
                  <div className="cell-muted">Verified client</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
