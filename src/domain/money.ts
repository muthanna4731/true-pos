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

/** Whole rupees only, rounded: `₹17,67,819`. For lists where paise are noise (the owner app's purchases and averages). */
export function formatINRWhole(p: Paise): string {
  const rupees = Math.round(Math.abs(p) / 100);
  return `${p < 0 && rupees > 0 ? '-' : ''}₹${grouped.format(rupees)}`;
}

/** Rupees (possibly fractional) to integer paise. */
export function rupeesToPaise(r: number): Paise {
  return Math.round(Number((r * 100).toPrecision(15)));
}

const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** Short money for a narrow strip: `₹999`, `₹42.1k`, `₹18.4L`, `₹1.96Cr`. Use `formatINR` wherever the exact figure fits. */
export function formatINRCompact(p: Paise): string {
  const abs = Math.abs(Math.round(p)) / 100;
  const sign = p < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 1)}L`;
  if (abs >= 1e4) return `${sign}₹${trim(abs / 1e3, 1)}k`;
  return formatINR(p);
}
