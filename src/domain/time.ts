const TZ = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dateParts = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeParts = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function istParts(iso: string): { year: string; month: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('bad_instant');
  const out: Record<string, string> = {};
  for (const p of dateParts.formatToParts(d)) out[p.type] = p.value;
  return { year: out.year, month: out.month, day: out.day };
}

/** IST calendar date `YYYY-MM-DD` of an ISO instant. */
export function istDate(iso: string): string {
  const { year, month, day } = istParts(iso);
  return `${year}-${month}-${day}`;
}

/** The instant an IST calendar day (`YYYY-MM-DD`) starts, as ISO UTC. */
export function istDayStart(istDay: string): string {
  const d = new Date(`${istDay}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) throw new Error('bad_day');
  return d.toISOString();
}

/** `12 Aug 2026` in IST. */
export function formatDate(iso: string): string {
  const { year, month, day } = istParts(iso);
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** `2:31 PM` in IST. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('bad_instant');
  const out: Record<string, string> = {};
  for (const p of timeParts.formatToParts(d)) out[p.type] = p.value;
  return `${out.hour}:${out.minute} ${out.dayPeriod.toUpperCase()}`;
}

/** Indian financial year (April to March) of an instant, by IST date: `26-27`. */
export function financialYear(iso: string): string {
  const { year, month } = istParts(iso);
  const y = Number(year);
  const start = Number(month) >= 4 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return `${two(start)}-${two(start + 1)}`;
}

let offsetDays = 0;

/** App clock. The day offset (demo time travel) is held in memory only. */
export const clock = {
  now(): string {
    return new Date(Date.now() + offsetDays * 86400000).toISOString();
  },
  setOffsetDays(n: number): void {
    offsetDays = n;
  },
};
