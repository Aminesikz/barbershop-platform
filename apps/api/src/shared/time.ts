/**
 * Half-open interval overlap test: does [aStart, aEnd) overlap [bStart, bEnd)?
 * Half-open so back-to-back intervals (10:00-10:30 and 10:30-11:00) do NOT overlap.
 */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
