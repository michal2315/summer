/** Wall-clock ↔ instant conversion in an IANA zone without a date library (uses Intl). */

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads y-m-d h:mi:s.ms. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string, s = 0, ms = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let t = guess - offsetMs(guess, timeZone);
  // Second pass settles instants that straddle a DST change.
  t = guess - offsetMs(t, timeZone);
  return new Date(t);
}

/** Calendar date (y, m, d) of an instant as seen in `timeZone`. */
export function zonedDate(instant: Date, timeZone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return [p.year, p.month, p.day];
}

/** `yyyy-MM-dd` + optional `HH:mm` (wall clock in `timeZone`) → instant. Returns null for malformed input. */
export function parseEventDate(date: string, time: string | undefined, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = time ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time) : null;
  if (!dm || (time && !tm)) return null;
  const [y, m, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const result = zonedTimeToUtc(y, m, d, tm ? Number(tm[1]) : 0, tm ? Number(tm[2]) : 0, timeZone);
  return zonedDate(result, timeZone)[2] === d ? result : null;
}

/** Inclusive instants of two calendar days (`yyyy-MM-dd`) in `timeZone`: start of `from` to end of `to`. */
export function calendarDayRange(from: string, to: string, timeZone: string): [Date, Date] {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return [zonedTimeToUtc(fy, fm, fd, 0, 0, timeZone), zonedTimeToUtc(ty, tm, td, 23, 59, timeZone, 59, 999)];
}

/**
 * Inclusive day range from two client instants (the client sends local midnights as ISO strings):
 * from the start of the first calendar day to the end of the last, in `timeZone`.
 */
export function dayRange(fromIso: string, toIso: string, timeZone: string): [Date, Date] | null {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
  const [fy, fm, fd] = zonedDate(from, timeZone);
  const [ty, tm, td] = zonedDate(to, timeZone);
  return [zonedTimeToUtc(fy, fm, fd, 0, 0, timeZone), zonedTimeToUtc(ty, tm, td, 23, 59, timeZone, 59, 999)];
}
