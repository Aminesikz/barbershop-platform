-- Dev seed data. Passwords are hashed with pgcrypto's bcrypt (cost 12),
-- which Node's bcrypt.compare verifies fine ($2a$ and $2b$ are compatible).
--
-- Demo credentials:
--   Owner       : owner@algiers-cuts.dz / OwnerPass123!
--   Barber      : barber@algiers-cuts.dz / BarberPass123!
--   Platform admin: admin@platform.dz / AdminPass123!   (TEMP — change after first login)
--   Active shop slug: algiers-cuts   |  Inactive shop slug: closed-shop

-- Platform super-admin (manages all shops via the separate admin app).
INSERT INTO platform_admins (email, password_hash, name) VALUES
  ('admin@platform.dz', crypt('AdminPass123!', gen_salt('bf', 12)), 'Platform Admin');

INSERT INTO shops (slug, timezone, is_active) VALUES
  ('algiers-cuts', 'Africa/Algiers', true),
  ('closed-shop',  'Africa/Algiers', false);

INSERT INTO shop_owners (shop_id, email, password_hash, name)
SELECT id, 'owner@algiers-cuts.dz', crypt('OwnerPass123!', gen_salt('bf', 12)), 'Karim Benali'
FROM shops WHERE slug = 'algiers-cuts';

INSERT INTO barbers (email, password_hash, name_ar, name_en, is_active) VALUES
  ('barber@algiers-cuts.dz', crypt('BarberPass123!', gen_salt('bf', 12)), 'سمير', 'Samir', true);

INSERT INTO barber_shops (barber_id, shop_id, is_active)
SELECT b.id, s.id, true
FROM barbers b, shops s
WHERE b.email = 'barber@algiers-cuts.dz' AND s.slug = 'algiers-cuts';

-- Shop-wide services for algiers-cuts.
INSERT INTO services (shop_id, name_ar, name_en, duration_min, price_dzd)
SELECT id, v.name_ar, v.name_en, v.duration_min, v.price_dzd
FROM shops, (VALUES
  ('قص شعر',        'Haircut',        30, 600),
  ('حلاقة ذقن',     'Beard trim',     15, 300),
  ('قص و حلاقة',    'Cut + beard',    45, 800)
) AS v(name_ar, name_en, duration_min, price_dzd)
WHERE shops.slug = 'algiers-cuts';

-- Split-shift working hours for the seeded barber, Sun-Thu (weekday 0..4):
-- 09:00-13:00 (540-780) then 15:00-20:00 (900-1200). Africa/Algiers wall-clock.
INSERT INTO working_hours (shop_id, barber_id, weekday, start_min, end_min)
SELECT s.id, b.id, wd.weekday, shift.start_min, shift.end_min
FROM shops s
JOIN barbers b ON b.email = 'barber@algiers-cuts.dz'
CROSS JOIN (VALUES (0),(1),(2),(3),(4)) AS wd(weekday)
CROSS JOIN (VALUES (540, 780), (900, 1200)) AS shift(start_min, end_min)
WHERE s.slug = 'algiers-cuts';
