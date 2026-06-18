/** Format an ISO-UTC instant as HH:MM in the given IANA timezone. */
export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso));
}

/** Format an ISO-UTC instant as "18 Jun, 09:00" in the given timezone. */
export function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso));
}

/** YYYY-MM-DD for today + N days (local). */
export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function serviceLabel(s: { nameEn: string | null; nameAr: string }): string {
  return s.nameEn ?? s.nameAr;
}

/** "algiers-cuts" → "Algiers Cuts" */
export function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
