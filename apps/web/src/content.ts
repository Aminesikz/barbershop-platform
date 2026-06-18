// Presentational marketing content for the public page (sample copy for the demo shop).

export interface BarberMeta {
  role: string;
  specialty: string;
  rating: number;
  reviews: number;
  bio: string;
}

const ROLES = ['Master Barber', 'Senior Barber', 'Style Specialist', 'Beard Expert'];
const SPECIALTIES = [
  'Classic cuts & hot-towel shaves',
  'Fades & modern styling',
  'Beard sculpting & grooming',
  'Scissor work & texturing',
];
const BIOS = [
  'Fifteen years behind the chair — known for precise classic cuts and a flawless hot-towel shave.',
  'Brings the latest fade and styling techniques, with a sharp eye for what suits each face.',
  'A specialist in beard shaping and grooming rituals that keep you looking sharp for weeks.',
  'Calm, meticulous and fast — the go-to for a clean scissor cut.',
];
const RATINGS = [5, 4.8, 4.9, 4.7];
const REVIEW_COUNTS = [128, 86, 64, 42];

export function barberMeta(i: number): BarberMeta {
  return {
    role: ROLES[i % ROLES.length]!,
    specialty: SPECIALTIES[i % SPECIALTIES.length]!,
    rating: RATINGS[i % RATINGS.length]!,
    reviews: REVIEW_COUNTS[i % REVIEW_COUNTS.length]!,
    bio: BIOS[i % BIOS.length]!,
  };
}

export interface Review {
  name: string;
  rating: number;
  text: string;
}

export const REVIEWS: Review[] = [
  { name: 'Yacine B.', rating: 5, text: 'Best fade I’ve had in Algiers. Booked online in seconds and was seen right on time.' },
  { name: 'Mehdi R.', rating: 5, text: 'Clean shop, friendly barbers, and the hot-towel shave is worth every dinar.' },
  { name: 'Sofiane K.', rating: 4, text: 'Quick, professional, and easy to rebook. My go-to spot now.' },
  { name: 'Riad T.', rating: 5, text: 'They really listen to what you want — came out exactly how I pictured it.' },
  { name: 'Amine D.', rating: 5, text: 'Online booking is a game changer. No more waiting around. Highly recommend.' },
  { name: 'Nabil H.', rating: 4, text: 'Great attention to detail on the beard trim. I’ll definitely be back.' },
];

export const HIGHLIGHTS = [
  { icon: '✂️', title: 'Expert barbers', text: 'Skilled hands for cuts, fades and classic shaves.' },
  { icon: '📅', title: 'Book in a minute', text: 'Pick a barber and time online — no phone calls.' },
  { icon: '🪒', title: 'Hot-towel shaves', text: 'A traditional grooming ritual, done right.' },
];

// Shown on the "For your business" portal — a pitch to other shop owners.
export const BUSINESS_PITCH = {
  eyebrow: 'The software behind this page',
  headline: 'Want online booking for your barbershop?',
  body:
    'This is a complete booking platform — a public booking page, a staff dashboard, ' +
    'per-barber schedules, and automatic double-booking protection. I can set one up for ' +
    'your shop too. Get in touch and we’ll get you online.',
};

// TODO: replace with your real contact details before sharing the link.
export const DEVELOPER_CONTACT = {
  email: 'roubaamine533@gmail.com',
  phone: '+213 555 00 00 00',
};
