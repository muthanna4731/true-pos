import { dayTotals, type DayTotals } from '../domain/reports';
import type { Product } from '../domain/types';
import { db } from './db';

const DAY_MS = 86400000;

/** The first instant of an IST day (`YYYY-MM-DD`) as an ISO string. */
export function istDayStart(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** The IST day after `day`. */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** The instants an IST day starts and ends at (end excluded), for a `[storeCode+at]` range. */
export function istDayRange(day: string): [string, string] {
  return [istDayStart(day), istDayStart(nextDay(day))];
}

/**
 * One shop's figures for an IST day. Reads the `[storeCode+at]` index for the month so far, and the lines and
 * payments of the day's bills only: the full history is never loaded.
 */
export async function loadDayTotals(storeCode: string, istDay: string): Promise<DayTotals> {
  const monthStart = istDayStart(`${istDay.slice(0, 8)}01`);
  const [dayStart, dayEnd] = istDayRange(istDay);
  const bills = await db.bills.where('[storeCode+at]').between([storeCode, monthStart], [storeCode, dayEnd], true, false).toArray();
  const numbers = bills.filter((b) => b.status === 'paid' && b.at >= dayStart).map((b) => b.number);
  const [lines, payments] = await Promise.all([
    db.billLines.where('billNumber').anyOf(numbers).toArray(),
    db.payments.where('billNumber').anyOf(numbers).toArray(),
  ]);
  const ids = [...new Set(lines.map((l) => l.productId))];
  const found = await db.products.bulkGet(ids);
  const products = new Map<string, Product>(found.flatMap((p) => (p ? [[p.id, p] as [string, Product]] : [])));
  return dayTotals(bills, lines, payments, products, storeCode, istDay);
}
