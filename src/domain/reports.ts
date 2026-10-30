import { formatTime, istDate } from './time';
import { typeOf } from './productType';
import { t } from '../i18n';
import type { Bill, BillLine, PayMode, Paise, Payment, Product } from './types';

export interface DayTotals {
  net: Paise;
  bills: number;
  avgBill: Paise;
  byMode: Record<PayMode, Paise>;
  /** Alcoholic and non-alcoholic sales (line amounts, after discount). */
  alc: Paise;
  nalc: Paise;
  /** Bottles and rupees per product type (`whisky`, `beer`, ... `other`). */
  byType: Record<string, { qty: number; amount: Paise }>;
  discount: Paise;
  /** Net sales from the 1st of the IST month up to and including the day. */
  monthToDate: Paise;
}

/**
 * The figures of one shop on one IST day. Only `paid` bills count: practice and void bills are left out.
 * `bills` may carry the whole month (for month to date); `lines` and `payments` only need cover the day.
 */
export function dayTotals(
  bills: Bill[],
  lines: BillLine[],
  payments: Payment[],
  products: Map<string, Product>,
  storeCode: string,
  istDay: string,
): DayTotals {
  const monthStart = `${istDay.slice(0, 8)}01`;
  const totals: DayTotals = {
    net: 0,
    bills: 0,
    avgBill: 0,
    byMode: { cash: 0, upi: 0, card: 0 },
    alc: 0,
    nalc: 0,
    byType: {},
    discount: 0,
    monthToDate: 0,
  };

  const today = new Set<string>();
  for (const b of bills) {
    if (b.storeCode !== storeCode || b.status !== 'paid') continue;
    const day = istDate(b.at);
    if (day < monthStart || day > istDay) continue;
    totals.monthToDate += b.net;
    if (day !== istDay) continue;
    today.add(b.number);
    totals.bills += 1;
    totals.net += b.net;
    totals.discount += b.discount;
  }
  totals.avgBill = totals.bills === 0 ? 0 : Math.round(totals.net / totals.bills);

  for (const p of payments) if (today.has(p.billNumber)) totals.byMode[p.mode] += p.amount;
  for (const l of lines) {
    if (!today.has(l.billNumber)) continue;
    const product = products.get(l.productId);
    if (product?.materialType === 'ALC') totals.alc += l.amount;
    else totals.nalc += l.amount;
    const type = product ? typeOf(product) : 'other';
    const row = (totals.byType[type] ??= { qty: 0, amount: 0 });
    row.qty += l.qty;
    row.amount += l.amount;
  }
  return totals;
}

/** The stamp on a report figure: the time for an open day, or a note that a closed day shows its locked numbers. */
export function reportAsOf(dayClose: { lockedAt: string } | undefined, nowIso: string): { locked: boolean; label: string } {
  return dayClose
    ? { locked: true, label: t('report.locked') }
    : { locked: false, label: t('report.asOf', { time: formatTime(nowIso) }) };
}

/** Is this stored value a `DayTotals` (the demo seed saved a smaller shape for past days)? */
export function isDayTotals(x: unknown): x is DayTotals {
  const v = x as Partial<DayTotals> | null;
  return typeof v === 'object' && v !== null && typeof v.net === 'number' && typeof v.byMode === 'object' && typeof v.byType === 'object';
}
