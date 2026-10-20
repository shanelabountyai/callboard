// Shift times are entered as a day plus "HH:MM" in the event's IANA timezone and stored as
// instants. Intl does the zone math, so there is no timezone dependency.

const parts = (at: Date, tz: string) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
};

/** "2026-10-03" + "09:30" in `tz` → the instant. ponytail: one offset pass, so a wall time inside a DST gap lands an hour off; nobody schedules a call at 2:30am on the spring-forward night. */
export function zonedToUtc(ymd: string, hm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  return new Date(guess - (parts(new Date(guess), tz) - guess));
}

/** A real calendar day. Date.parse alone takes "2026-02-30" and rolls it into March, so the day must read back the same. */
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const isHm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** A @db.Date column comes back as UTC midnight; this is the day it names. */
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

const fmt = (opts: Intl.DateTimeFormatOptions) => (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d);
export const fmtTime = fmt({ hour: 'numeric', minute: '2-digit' }); // 6:30 AM
/** A stored "17:00" as the rest of the app writes a time: "5:00 PM". Anything else is shown as it is. */
export const fmtHm = (hm: string) => (isHm(hm) ? `${+hm.slice(0, 2) % 12 || 12}${hm.slice(2)} ${+hm.slice(0, 2) < 12 ? 'AM' : 'PM'}` : hm);
export const fmtWhen = fmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); // Sat, Oct 3, 8:00 AM
export const fmtDay = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
