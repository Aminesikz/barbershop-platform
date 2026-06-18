export function Footer({ shopName }: { shopName: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-col">
          <div className="footer-brand">
            <span className="brand-dot" /> {shopName}
          </div>
          <p className="footer-about">
            Premium grooming and classic barbering in the heart of Algiers. Walk-ins welcome,
            bookings preferred — sharp cuts, hot-towel shaves, and a seat that’s always ready.
          </p>
        </div>

        <div className="footer-col">
          <h4>Opening hours</h4>
          <ul className="footer-list">
            <li>
              <span>Sun – Thu</span>
              <span>09:00 – 20:00</span>
            </li>
            <li>
              <span>Friday</span>
              <span>Closed</span>
            </li>
            <li>
              <span>Saturday</span>
              <span>Closed</span>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Visit us</h4>
          <ul className="footer-list plain">
            <li>12 Rue Didouche Mourad</li>
            <li>Algiers, Algeria</li>
            <li>+213 5 00 00 00 00</li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        © {year} {shopName} · Crafted with care
      </div>
    </footer>
  );
}
