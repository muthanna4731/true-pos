import type { Paise } from './types';

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const grouped2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer paise to display text: `₹29,41,601`, `₹177.27`. No decimals when whole. */
export function formatINR(p: Paise): string {
  const abs = Math.abs(Math.round(p));
  const whole = abs % 100 === 0;
  const text = whole ? grouped.format(abs / 100) : grouped2.format(abs / 100);
  return `${p < 0 ? '-' : ''}₹${text}`;
}

/** Rupees (possibly fractional) to integer paise. */
export function rupeesToPaise(r: number): Paise {
  return Math.round(Number((r * 100).toPrecision(15)));
}
