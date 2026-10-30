import { formatINR } from './money';
import { avgDailySales, minLevel } from './orders';
import { onHandMap } from './stock';
import { formatDate, istDate, istDayStart } from './time';
import type { Todo } from './todos';
import type { Bill, DayClose, PayMode, Paise, Payment, Shift, StockMovement, Store } from './types';

export interface ShopSummary {
  storeCode: string;
  name: string;
  net: Paise;
  bills: number;
  byMode: Record<PayMode, Paise>;
  /** How much less cash was counted than expected at close (0 when the till was right or over). */
  cashShort: Paise;
  lowStock: number;
  deliveryShort: number;
  closed: boolean;
}

export interface ShopSummaryInput {
  stores: Store[];
  bills: Bill[];
  payments: Payment[];
  shifts: Shift[];
  dayCloses: DayClose[];
  /** Used for short-delivery counts (`delivery_short` items per shop). */
  todos: Todo[];
  /** Used for low stock, with the same rule as the office to-do list. */
  movements: StockMovement[];
  /** The IST day (`YYYY-MM-DD`) to summarise. */
  istDay: string;
  nowIso: string;
}

/** One row per shop for an IST day. Only paid bills count: practice and void bills are left out. */
export function shopSummaries(input: ShopSummaryInput): ShopSummary[] {
  const { istDay } = input;
  const paid = new Map<string, string>(); // bill number -> shop, for paid bills of the day
  const rows = new Map<string, ShopSummary>();
  for (const s of input.stores) {
    rows.set(s.code, {
      storeCode: s.code,
      name: s.name,
      net: 0,
      bills: 0,
      byMode: { cash: 0, upi: 0, card: 0 },
      cashShort: 0,
      lowStock: 0,
      deliveryShort: 0,
      closed: input.dayCloses.some((d) => d.storeCode === s.code && d.date === istDay),
    });
  }
  for (const b of input.bills) {
    const row = rows.get(b.storeCode);
    if (!row || b.status !== 'paid' || istDate(b.at) !== istDay) continue;
    paid.set(b.number, b.storeCode);
    row.bills += 1;
    row.net += b.net;
  }
  for (const p of input.payments) {
    const code = paid.get(p.billNumber);
    if (code) rows.get(code)!.byMode[p.mode] += p.amount;
  }

  const diffs = new Map<string, number>();
  for (const sh of input.shifts) {
    if (sh.closedAt === undefined || istDate(sh.openedAt) !== istDay) continue;
    diffs.set(sh.storeCode, (diffs.get(sh.storeCode) ?? 0) + (sh.diff ?? 0));
  }
  for (const [code, diff] of diffs) if (rows.has(code)) rows.get(code)!.cashShort = Math.max(0, -diff);

  for (const todo of input.todos) {
    const row = todo.kind === 'delivery_short' ? rows.get(todo.storeCode) : undefined;
    if (row) row.deliveryShort += 1;
  }

  const stock = onHandMap(input.movements);
  for (const [key, avg] of avgDailySales(input.movements, input.nowIso)) {
    if (avg <= 0 || (stock.get(key) ?? 0) >= minLevel(avg)) continue;
    const row = rows.get(key.split('|')[0]);
    if (row) row.lowStock += 1;
  }
  return input.stores.map((s) => rows.get(s.code)!);
}

/** Net sales of paid bills from the 1st of the IST month up to and including the day, all shops together. */
export function chainMonthToDate(bills: Bill[], istDay: string): Paise {
  const start = `${istDay.slice(0, 8)}01`;
  let total = 0;
  for (const b of bills) {
    if (b.status !== 'paid') continue;
    const day = istDate(b.at);
    if (day >= start && day <= istDay) total += b.net;
  }
  return total;
}

/**
 * The WhatsApp nightly summary: text only, no offers, prices or links. `date` is an IST day (`YYYY-MM-DD`)
 * or an ISO instant.
 */
export function nightlySummaryText(date: string, rows: Pick<ShopSummary, 'name' | 'net' | 'byMode' | 'cashShort' | 'closed'>[]): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? istDayStart(date) : date;
  const lines = rows.map(
    (r) =>
      `${r.name}: ${formatINR(r.net)} (Cash ${formatINR(r.byMode.cash)}, UPI ${formatINR(r.byMode.upi)}, Card ${formatINR(r.byMode.card)}) · cash short ${formatINR(r.cashShort)} · ${r.closed ? 'closed ✓' : 'not closed'}`,
  );
  const chain = rows.reduce((s, r) => s + r.net, 0);
  return [`True Spirits · ${formatDate(day)}`, ...lines, `Chain: ${formatINR(chain)}`].join('\n');
}
