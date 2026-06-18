import { Link, Outlet } from 'react-router-dom';
import { getShopSlug } from '../api';
import { titleCase } from '../util';
import { Footer } from '../components/Footer';

/**
 * Customer-facing shell. Brand = the shop's name; the only entry beyond the
 * booking page is "For your business" (staff/admin live elsewhere).
 */
export function PublicLayout() {
  const shopName = titleCase(getShopSlug());
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" /> {shopName}
        </div>
        <div className="header-right">
          <Link to="/business" className="btn btn-ghost btn-sm">
            For your business
          </Link>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <Footer shopName={shopName} />
    </>
  );
}
