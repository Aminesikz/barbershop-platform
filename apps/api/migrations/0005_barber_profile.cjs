// Owner-written public profile on barbers (role/specialty/bio), replacing the
// auto-filled placeholder copy the shop page used to rotate through. Person-level
// (like name_ar/name_en): a barber working at two shops shows the same profile.
// All optional — the page renders only what the owner filled in.

exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE barbers
  ADD COLUMN role_title text CHECK (role_title IS NULL OR char_length(role_title) <= 60),
  ADD COLUMN specialty  text CHECK (specialty  IS NULL OR char_length(specialty)  <= 100),
  ADD COLUMN bio        text CHECK (bio        IS NULL OR char_length(bio)        <= 400);
`);
};

exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE barbers
  DROP COLUMN IF EXISTS role_title,
  DROP COLUMN IF EXISTS specialty,
  DROP COLUMN IF EXISTS bio;
`);
};
