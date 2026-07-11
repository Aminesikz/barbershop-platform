import { useEffect, useState } from 'react';
import type {
  ServiceDTO,
  BarberDTO,
  AvailabilityDTO,
  PublicBookingDTO,
  PublicReviewDTO,
  ReviewSummaryDTO,
} from '@barber/shared-types';
import { api, errorMessage } from '../api';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, Field, Input, Spinner, Stars } from '../components/ui';
import { fmtTime, fmtDateTime, todayPlus, uuid, serviceLabel, titleCase } from '../util';
import { HIGHLIGHTS } from '../content';

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
  const [reviews, setReviews] = useState<PublicReviewDTO[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryDTO | null>(null);
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
        const [svc, brb, rev] = await Promise.all([
          api<{ services: ServiceDTO[] }>('/api/services'),
          api<{ barbers: BarberDTO[] }>('/api/barbers'),
          api<{ summary: ReviewSummaryDTO; reviews: PublicReviewDTO[] }>('/api/reviews'),
        ]);
        setServices(svc.services);
        setBarbers(brb.barbers);
        setReviews(rev.reviews);
        setReviewSummary(rev.summary);
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
      {/* Hero — the storefront sign */}
      <section className="hero">
        <div className="hero-eyebrow">Book online — no phone calls, no waiting</div>
        <h1 className="hero-title">{shopName}</h1>
        <div className="hero-rule" aria-hidden="true" />
        <p className="hero-sub">
          Sharp cuts, classic shaves, and a chair that’s always ready. Book your barber online in
          under a minute.
        </p>
        <div className="hero-meta">
          {reviewSummary && reviewSummary.count > 0 && reviewSummary.average !== null ? (
            <>
              <Stars value={reviewSummary.average} small />
              <strong>{reviewSummary.average.toFixed(1)}</strong>
              <span>
                ({reviewSummary.count} {reviewSummary.count === 1 ? 'review' : 'reviews'})
              </span>
              <span className="sep">·</span>
            </>
          ) : null}
          <span>Open Sun–Thu 09:00–20:00</span>
          <span className="sep">·</span>
          <span>Walk-ins welcome</span>
        </div>
        <Button className="btn-lg" onClick={scrollToBooking}>
          Book an appointment
        </Button>
      </section>

      {/* Highlights */}
      <div className="highlights" style={{ marginTop: 28 }}>
        {HIGHLIGHTS.map((h) => (
          <div className="highlight" key={h.title}>
            <h4>{h.title}</h4>
            <p>{h.text}</p>
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
          <div className="success-box">
            <div className="ticket-head">You’re booked</div>
            <div className="ticket-rows">
              <div className="ticket-row">
                <span className="k">Service</span>
                <span className="leader" aria-hidden="true" />
                <span className="v">{serviceLabel(result.service)}</span>
              </div>
              <div className="ticket-row">
                <span className="k">Barber</span>
                <span className="leader" aria-hidden="true" />
                <span className="v">{result.barber.nameEn ?? result.barber.nameAr}</span>
              </div>
              <div className="ticket-row">
                <span className="k">When</span>
                <span className="leader" aria-hidden="true" />
                <span className="v">{fmtDateTime(result.start, tz)}</span>
              </div>
            </div>
            <p className="hint">
              {email.trim()
                ? `A confirmation email is on its way to ${email.trim()}.`
                : 'The shop will confirm your appointment shortly.'}
            </p>
            <Button variant="ghost" onClick={reset}>
              Book another
            </Button>
          </div>
        ) : (
          <Card>
            {/* 01 — the price board */}
            <div className="board-section">
              <div className="step-head">
                <span className="step-num">01</span>
                <h3>Service</h3>
                <span className="rule" aria-hidden="true" />
              </div>
              <div className="board-list">
                {services.map((s) => (
                  <button
                    key={s.id}
                    className={`board-row ${serviceId === s.id ? 'selected' : ''}`}
                    aria-pressed={serviceId === s.id}
                    onClick={() => setServiceId(s.id)}
                  >
                    <span className="board-name">{serviceLabel(s)}</span>
                    <span className="board-meta">{s.durationMin} min</span>
                    <span className="board-leader" aria-hidden="true" />
                    <span className="board-price">{s.priceDzd} DZD</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 02 — the chair */}
            <div className="board-section">
              <div className="step-head">
                <span className="step-num">02</span>
                <h3>Barber</h3>
                <span className="rule" aria-hidden="true" />
              </div>
              <div className="pick-row">
                {barbers.map((b) => {
                  const display = b.nameEn ?? b.nameAr;
                  return (
                    <button
                      key={b.id}
                      className={`pick ${barberId === b.id ? 'selected' : ''}`}
                      aria-pressed={barberId === b.id}
                      onClick={() => setBarberId(b.id)}
                    >
                      <Avatar name={display} />
                      <span>
                        <span className="pick-name">{display}</span>
                        <span className="pick-sub">{b.role ?? 'Barber'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 03 — the appointment book */}
            <div className="board-section">
              <div className="step-head">
                <span className="step-num">03</span>
                <h3>Day &amp; time</h3>
                <span className="rule" aria-hidden="true" />
              </div>
              <div className="stack">
                <div style={{ maxWidth: 220 }}>
                  <Field label={`Date — shop time (${tz})`}>
                    <Input
                      type="date"
                      value={date}
                      min={todayPlus(0)}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                </div>
                {!serviceId || !barberId ? (
                  <p className="hint" style={{ margin: 0 }}>
                    Pick a service and a barber to see open times.
                  </p>
                ) : slotsLoading ? (
                  <Spinner />
                ) : slots.length === 0 ? (
                  <div className="empty">No open slots for this day. Try another date or barber.</div>
                ) : (
                  <div className="slot-grid">
                    {slots.map((s) => (
                      <button
                        key={s.start}
                        className={`slot ${selected === s.start ? 'selected' : ''}`}
                        aria-pressed={selected === s.start}
                        onClick={() => setSelected(s.start)}
                      >
                        {fmtTime(s.start, tz)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 04 — who's coming */}
            {canPickDetails ? (
              <div className="board-section">
                <div className="step-head">
                  <span className="step-num">04</span>
                  <h3>Your details</h3>
                  <span className="rule" aria-hidden="true" />
                </div>
                <div className="stack">
                  <p className="hint" style={{ margin: 0 }}>
                    {selected ? fmtDateTime(selected, tz) : ''}
                  </p>
                  <div className="grid-2">
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
                  <div>
                    <Button onClick={() => void submit()} disabled={!canSubmit}>
                      {submitting ? 'Booking…' : 'Confirm booking'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        )}
      </section>

      {/* Barbers / about */}
      {barbers.length > 0 ? (
        <section className="section">
          <div className="section-eyebrow">The team</div>
          <h2 className="section-title">Meet our barbers</h2>
          <div className="barber-grid">
            {barbers.map((b) => {
              const display = b.nameEn ?? b.nameAr;
              const stats = reviewSummary?.barbers.find((s) => s.barberId === b.id);
              return (
                <div className="barber-card" key={b.id}>
                  <div className="barber-top">
                    <Avatar name={display} />
                    <div>
                      <div className="barber-name">{display}</div>
                      <div className="barber-role">{b.role ?? 'Barber'}</div>
                    </div>
                  </div>
                  {b.bio ? <p className="barber-bio">{b.bio}</p> : null}
                  {stats ? (
                    <div className="rating-line">
                      <Stars value={stats.average} small /> {stats.average.toFixed(1)} · {stats.count}{' '}
                      {stats.count === 1 ? 'review' : 'reviews'}
                    </div>
                  ) : null}
                  <div className="barber-foot">
                    <span className="barber-specialty">{b.specialty ?? ''}</span>
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

      {/* Reviews — real, verified (submitted via post-visit review links) and
          owner-approved. The section only renders once the shop has some. */}
      {reviews.length > 0 ? (
        <section className="section">
          <div className="section-eyebrow">Reviews</div>
          <h2 className="section-title">What our clients say</h2>
          <div className="reviews-grid">
            {reviews.map((r) => (
              <div className="review-card" key={r.id}>
                <Stars value={r.rating} />
                {r.comment ? <p className="review-quote">“{r.comment}”</p> : null}
                <div className="review-author">
                  <Avatar name={r.customerName} />
                  <div>
                    <div className="nm">{r.customerName}</div>
                    <div className="cell-muted">Verified client</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
