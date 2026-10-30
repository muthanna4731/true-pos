import type { PayMode, Paise } from './types';

/** Notes the till gives back, largest first (rupees). Anything smaller comes back as coins. */
const NOTES = [500, 200, 100, 50, 20, 10];

/** "Customer gave" shortcuts, smallest first. Only notes above the total are offered. */
const TENDER_NOTES: Paise[] = [50000, 100000, 200000];

/** Change in the fewest notes, and what is left over as coins (paise). */
export function changeNotes(change: Paise): { notes: { rupees: number; count: number }[]; coins: Paise } {
  let left = Math.max(0, Math.round(change));
  const notes: { rupees: number; count: number }[] = [];
  for (const rupees of NOTES) {
    const count = Math.floor(left / (rupees * 100));
    if (count > 0) {
      notes.push({ rupees, count });
      left -= count * rupees * 100;
    }
  }
  return { notes, coins: left };
}

/** The quick "customer gave" buttons: exact, then ₹500, ₹1,000 and ₹2,000 when they are above the total. */
export function quickTenders(total: Paise): ('exact' | Paise)[] {
  return ['exact', ...TENDER_NOTES.filter((n) => n > total)];
}

/** Cash in the drawer from note counts (keyed by rupee value) plus loose coins in paise. */
export function cashFromNotes(counts: Record<number, number>, coins: Paise): Paise {
  let total = coins;
  for (const [rupees, count] of Object.entries(counts)) total += Number(rupees) * 100 * count;
  return total;
}

/** A split payment is valid when every part is above zero, no mode repeats, and the parts add up to the total. */
export function validateSplit(total: Paise, parts: { mode: PayMode; amount: Paise }[]): boolean {
  if (parts.length === 0) return false;
  if (parts.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) return false;
  if (new Set(parts.map((p) => p.mode)).size !== parts.length) return false;
  return parts.reduce((sum, p) => sum + p.amount, 0) === total;
}
