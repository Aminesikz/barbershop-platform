import { getShopSlug } from '../api';
import { Card } from '../components/ui';
import { BUSINESS_PITCH, DEVELOPER_CONTACT } from '../content';

/**
 * Shown when the hostname ADDRESSES a shop that doesn't exist or isn't active
 * (unknown subdomain / inactive shop). The bare apex and reserved subdomains render
 * LandingPage instead. Replaces the whole app so we never render a broken booking page.
 */
export function ShopNotFound() {
  const slug = getShopSlug();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Shop not found</h1>
        <p>
          {slug ? (
            <>
              We couldn’t find an active shop at <strong>{slug}</strong>.
            </>
          ) : (
            <>No shop is configured for this address.</>
          )}
        </p>
      </div>

      <Card>
        <div className="card-pad stack">
          <p className="muted">The link may be mistyped, or the shop isn’t live yet.</p>
          <div>
            <div className="section-eyebrow">{BUSINESS_PITCH.eyebrow}</div>
            <h2 className="section-title">{BUSINESS_PITCH.headline}</h2>
            <p className="muted" style={{ maxWidth: 520 }}>
              {BUSINESS_PITCH.body}
            </p>
            <div className="row-wrap" style={{ marginTop: 16 }}>
              <a className="btn btn-primary" href={`mailto:${DEVELOPER_CONTACT.email}`}>
                ✉&nbsp; {DEVELOPER_CONTACT.email}
              </a>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
