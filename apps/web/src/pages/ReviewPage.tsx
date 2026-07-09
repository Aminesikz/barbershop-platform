import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PublicReviewDTO, ReviewContextDTO } from '@barber/shared-types';
import { api, errorMessage } from '../api';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Spinner } from '../components/ui';
import { fmtDateTime, serviceLabel, titleCase } from '../util';

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** Interactive 1..5 star picker for the review form. */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="star-picker" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= value ? 'star on' : 'star'}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
      <span className="star-picker-label">{RATING_LABELS[value] ?? ''}</span>
    </div>
  );
}

/**
 * Landing page for the one-time review link emailed after a completed booking
 * (/review?token=…). The token is validated up front so a dead link fails fast,
 * then again on submit (single-use).
 */
export function ReviewPage() {
  const { shop } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const shopName = shop?.name ?? titleCase(shop?.slug ?? '');
  const tz = shop?.timezone ?? 'Africa/Algiers';

  const [context, setContext] = useState<ReviewContextDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    void api<{ context: ReviewContextDTO }>(`/api/reviews/context?token=${encodeURIComponent(token)}`)
      .then((r) => setContext(r.context))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await api<{ review: PublicReviewDTO }>('/api/reviews', {
        method: 'POST',
        body: { token, rating, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <section className="section" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="section-eyebrow">Reviews</div>
        <h2 className="section-title">How was your visit?</h2>

        {loading ? (
          <Spinner />
        ) : invalid ? (
          <Card>
            <div className="card-pad stack">
              <div className="empty">
                This review link is invalid, already used, or has expired. Reviews can only be
                left through the link we email after a completed appointment.
              </div>
              <div>
                <Link to="/">
                  <Button variant="ghost">Back to {shopName}</Button>
                </Link>
              </div>
            </div>
          </Card>
        ) : done ? (
          <Card>
            <div className="card-pad stack">
              <div className="success-box">
                <strong>Thanks for your review!</strong> It will appear on the page once the shop
                approves it.
              </div>
              <div>
                <Link to="/">
                  <Button>Back to {shopName}</Button>
                </Link>
              </div>
            </div>
          </Card>
        ) : context ? (
          <Card>
            <div className="card-head">
              <div>
                <h2>Hi {context.customerName.split(' ')[0]}</h2>
                <p>
                  {serviceLabel(context.service)} with {context.barber.nameEn ?? context.barber.nameAr}{' '}
                  — {fmtDateTime(context.start, tz)}
                </p>
              </div>
            </div>
            <div className="card-pad stack">
              <Field label="Your rating">
                <StarPicker value={rating} onChange={setRating} />
              </Field>
              <Field label="Your review (optional)">
                <textarea
                  className="input"
                  rows={4}
                  maxLength={600}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What did you like? Anything the shop could improve?"
                />
              </Field>
              {error ? <span className="error-text">{error}</span> : null}
              <div>
                <Button onClick={() => void submit()} disabled={rating < 1 || submitting}>
                  {submitting ? 'Sending…' : 'Send review'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
