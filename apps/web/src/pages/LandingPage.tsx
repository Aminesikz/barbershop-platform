import { useEffect } from 'react';
import { Card } from '../components/ui';
import { BUSINESS_PITCH, DEVELOPER_CONTACT, PLATFORM_LANDING } from '../content';

/**
 * Where the "live demo" button points. On real domains the demo shop lives on
 * its own subdomain; on localhost (no subdomains) fall back to the ?shop= param.
 */
function demoUrl(): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return `/?shop=${PLATFORM_LANDING.demoSlug}`;
  }
  const parts = hostname.split('.');
  const base = parts.length >= 3 ? parts.slice(1).join('.') : hostname;
  return `${protocol}//${PLATFORM_LANDING.demoSlug}.${base}/`;
}

/**
 * Product landing page, served from the bare apex domain (and reserved
 * subdomains like www) where no shop is addressed. Unknown shop slugs render
 * ShopNotFound instead — this page is only for the platform's front door.
 */
export function LandingPage() {
  const L = PLATFORM_LANDING;

  useEffect(() => {
    const prev = document.title;
    document.title = `${L.brand} — Online booking for barbershops`;
    return () => {
      document.title = prev;
    };
  }, [L.brand]);

  const phoneHref = `tel:${DEVELOPER_CONTACT.phone.replace(/\s/g, '')}`;

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" /> {L.brand}
        </div>
        <div className="header-right">
          <a className="btn btn-ghost btn-sm" href={`mailto:${DEVELOPER_CONTACT.email}`}>
            Contact
          </a>
        </div>
      </header>

      <main>
        <div className="page">
          <section className="hero">
            <div className="hero-eyebrow">{L.eyebrow}</div>
            <h1 className="hero-title">{L.headline}</h1>
            <p className="hero-sub">{L.sub}</p>
            <div className="row-wrap" style={{ justifyContent: 'center' }}>
              <a className="btn btn-primary btn-lg" href={`mailto:${DEVELOPER_CONTACT.email}`}>
                Get your shop online
              </a>
              <a className="btn btn-ghost btn-lg" href={demoUrl()}>
                See a live demo
              </a>
            </div>
          </section>

          <section className="section">
            <div className="section-eyebrow">What you get</div>
            <h2 className="section-title">Everything a barbershop needs to take bookings</h2>
            <div className="highlights">
              {L.features.map((f) => (
                <div key={f.title} className="highlight">
                  <div className="ico">{f.icon}</div>
                  <div>
                    <h4>{f.title}</h4>
                    <p>{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section-eyebrow">How it works</div>
            <h2 className="section-title">Live in a day</h2>
            <div className="highlights">
              {L.steps.map((s) => (
                <div key={s.n} className="highlight">
                  <div className="ico">{s.n}</div>
                  <div>
                    <h4>{s.title}</h4>
                    <p>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

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

          <Card>
            <div className="card-pad">
              <p className="hint" style={{ margin: 0 }}>
                Already on {L.brand}? Open your shop’s own address (yourshop.
                {window.location.hostname.replace(/^www\./, '')}) and sign in from “For your
                business”.
              </p>
            </div>
          </Card>
        </div>
      </main>

      <div className="footer-bottom">
        © {new Date().getFullYear()} {L.brand} — online booking for barbershops in Algeria.
      </div>
    </>
  );
}
