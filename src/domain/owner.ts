import { formatINR } from './money';
import { avgDailySales, minLevel } from './orders';
import type { DiscountRow } from './reports';
import { onHandMap, stockFlows } from './stock';
import { addIstDays, formatDate, istDate, istDayStart } from './time';
import type { Todo } from './todos';
import type { Bill, BillLine, DayClose, Grn, PayMode, Paise, Payment, Product, Shift, StockMovement, Store, Supplier, Transfer } from './types';

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

// ---------------------------------------------------------------------------------------------------------------
// Figures for the owner app. Every function is pure: the screens read the records and pass them in.
// "Scope" is one shop's code, or null for every shop together. Only paid bills count (practice and void are left
// out), and days are IST days.
// ---------------------------------------------------------------------------------------------------------------

/** Which shops a figure covers: one shop's code, or `null` for all of them. */
export type ShopScope = string | null;

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const IST_OFFSET_MS = 19800000;

const inScope = (code: string, scope: ShopScope): boolean => scope === null || code === scope;

/** The `[from, to)` instants an IST day covers, as ISO strings that compare in time order. */
function dayBounds(istDay: string): [string, string] {
  return [istDayStart(istDay), istDayStart(addIstDays(istDay, 1))];
}

/** Paid bills of the scope whose time is in `[from, to)`. */
function paidBetween(bills: Bill[], scope: ShopScope, from: string, to: string): Bill[] {
  return bills.filter((b) => b.status === 'paid' && inScope(b.storeCode, scope) && b.at >= from && b.at < to);
}

/** Weekday of an IST day, 0 = Sunday. */
export function istWeekday(istDay: string): number {
  return new Date(`${istDay}T00:00:00Z`).getUTCDay();
}

export interface SalesFigures {
  net: Paise;
  bills: number;
  avgBill: Paise;
  discount: Paise;
  /** Discount as tenths of a percent of the net sales (22 = 2.2%). */
  discountTenthPct: number;
  /** Alcoholic and other sales, from the line amounts; together they equal `net`. */
  alc: Paise;
  nalc: Paise;
}

/** The live card for one IST day: sales, bills, average, discount and the alcoholic / other split. */
export function salesFigures(bills: Bill[], lines: BillLine[], products: Map<string, Product>, istDay: string, scope: ShopScope): SalesFigures {
  const [from, to] = dayBounds(istDay);
  const day = paidBetween(bills, scope, from, to);
  const numbers = new Set(day.map((b) => b.number));
  const net = day.reduce((s, b) => s + b.net, 0);
  const discount = day.reduce((s, b) => s + b.discount, 0);
  let alc = 0;
  let nalc = 0;
  for (const l of lines) {
    if (!numbers.has(l.billNumber)) continue;
    if (products.get(l.productId)?.materialType === 'ALC') alc += l.amount;
    else nalc += l.amount;
  }
  return {
    net,
    bills: day.length,
    avgBill: day.length === 0 ? 0 : Math.round(net / day.length),
    discount,
    discountTenthPct: net === 0 ? 0 : Math.round((discount * 1000) / net),
    alc,
    nalc,
  };
}

export interface WeekdayDelta {
  current: Paise;
  previous: Paise;
  /** Whole percent against the same weekday a week earlier; null when that day had no sales. */
  pct: number | null;
  /** Weekday of the day, 0 = Sunday. */
  weekday: number;
}

/**
 * The day's net sales against the same weekday a week before ("up 12% vs last Monday"). While `istDay` is the day of
 * `nowIso` the comparison is like for like: last week counts only up to the same IST time of day. Past days compare whole.
 */
export function weekdayDelta(bills: Bill[], istDay: string, scope: ShopScope, nowIso?: string): WeekdayDelta {
  const net = (day: string, until?: string): Paise => {
    const [from, to] = dayBounds(day);
    return paidBetween(bills, scope, from, until && until < to ? until : to).reduce((s, b) => s + b.net, 0);
  };
  const live = nowIso !== undefined && istDate(nowIso) === istDay;
  const previousDay = addIstDays(istDay, -7);
  const cut = live ? new Date(Date.parse(istDayStart(previousDay)) + (Date.parse(nowIso) - Date.parse(istDayStart(istDay)))).toISOString() : undefined;
  const current = net(istDay);
  const previous = net(previousDay, cut);
  return { current, previous, pct: previous === 0 ? null : Math.round(((current - previous) * 100) / previous), weekday: istWeekday(istDay) };
}

/** The top of the IST hour that `nowIso` falls in. IST is UTC+5:30, so its hours begin at half past in UTC. */
export function istHourStart(nowIso: string): string {
  const ms = Date.parse(nowIso);
  return new Date(Math.floor((ms + IST_OFFSET_MS) / HOUR_MS) * HOUR_MS - IST_OFFSET_MS).toISOString();
}

/** What was billed since the top of the current IST hour. */
export function hourSales(bills: Bill[], nowIso: string, scope: ShopScope): { net: Paise; bills: number; sinceIso: string } {
  const sinceIso = istHourStart(nowIso);
  const until = new Date(Date.parse(sinceIso) + HOUR_MS).toISOString();
  const hour = paidBetween(bills, scope, sinceIso, until);
  return { net: hour.reduce((s, b) => s + b.net, 0), bills: hour.length, sinceIso };
}

export interface RankedProduct {
  productId: string;
  units: number;
  amount: Paise;
}

/** The best sellers of an IST day by amount (ties by product id). */
export function rankProducts(bills: Bill[], lines: BillLine[], istDay: string, scope: ShopScope, n = 3): RankedProduct[] {
  const [from, to] = dayBounds(istDay);
  const numbers = new Set(paidBetween(bills, scope, from, to).map((b) => b.number));
  const by = new Map<string, RankedProduct>();
  for (const l of lines) {
    if (!numbers.has(l.billNumber)) continue;
    const row = by.get(l.productId) ?? { productId: l.productId, units: 0, amount: 0 };
    row.units += l.qty;
    row.amount += l.amount;
    by.set(l.productId, row);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount || (a.productId < b.productId ? -1 : 1)).slice(0, n);
}

/** Units of one product sold on each of the `days` IST days ending on `endDay`, oldest first. */
export function dailyUnits(bills: Bill[], lines: BillLine[], productId: string, endDay: string, scope: ShopScope, days = 7): number[] {
  const startDay = addIstDays(endDay, -(days - 1));
  const startMs = Date.parse(istDayStart(startDay));
  const endIso = istDayStart(addIstDays(endDay, 1));
  const slot = new Map<string, number>();
  for (const b of paidBetween(bills, scope, istDayStart(startDay), endIso)) slot.set(b.number, Math.floor((Date.parse(b.at) - startMs) / DAY_MS));
  const out = new Array<number>(days).fill(0);
  for (const l of lines) {
    const i = l.productId === productId ? slot.get(l.billNumber) : undefined;
    if (i !== undefined) out[i] += l.qty;
  }
  return out;
}

/** Up, flat or down: the last three days of a series against the first three, with a 15% band counted as flat. */
export function trendOf(series: number[]): 'up' | 'flat' | 'down' {
  const k = Math.min(3, Math.floor(series.length / 2));
  if (k === 0) return 'flat';
  const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
  const first = sum(series.slice(0, k));
  const last = sum(series.slice(-k));
  if (last > first * 1.15) return 'up';
  if (last < first * 0.85) return 'down';
  return 'flat';
}

/** An axis-less sparkline as an SVG path in a `width` x `height` box, 2px of padding top and bottom. Empty for no data. */
export function sparkPath(series: number[], width = 44, height = 18): string {
  if (series.length === 0) return '';
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const pad = 2;
  const num = (n: number): number => Number(n.toFixed(1));
  return series
    .map((v, i) => {
      const x = series.length === 1 ? 0 : (i * width) / (series.length - 1);
      const y = hi === lo ? height / 2 : height - pad - ((v - lo) / (hi - lo)) * (height - 2 * pad);
      return `${i === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`;
    })
    .join(' ');
}

export interface RunningOutRow {
  storeCode: string;
  productId: string;
  onHand: number;
  level: 'out' | 'low';
  /** Bottles sold on the day, net of voids. */
  soldOnDay: number;
}

/**
 * The shop and product pairs that are out or low, by the same rule as the office to-do list (a product that sells,
 * with less stock than its reorder level). Out first, then the least left.
 */
export function runningOut(movements: StockMovement[], nowIso: string, istDay: string, scope: ShopScope): RunningOutRow[] {
  const mine = scope === null ? movements : movements.filter((m) => m.storeCode === scope);
  const stock = onHandMap(mine);
  const [from, to] = dayBounds(istDay);
  const sold = new Map<string, number>();
  for (const m of mine) {
    if ((m.kind !== 'sale' && m.kind !== 'void') || m.at < from || m.at >= to) continue;
    const key = `${m.storeCode}|${m.productId}`;
    sold.set(key, (sold.get(key) ?? 0) - m.qty);
  }
  const rows: RunningOutRow[] = [];
  for (const [key, avg] of avgDailySales(mine, nowIso)) {
    const onHand = stock.get(key) ?? 0;
    if (avg <= 0 || onHand >= minLevel(avg)) continue;
    const [storeCode, productId] = key.split('|');
    rows.push({ storeCode, productId, onHand, level: onHand <= 0 ? 'out' : 'low', soldOnDay: sold.get(key) ?? 0 });
  }
  return rows.sort((a, b) => a.onHand - b.onHand || (a.storeCode + a.productId < b.storeCode + b.productId ? -1 : 1));
}

/** Closing stock at the end of an IST day: its value at landed cost, and how many products have stock. */
export function stockTotals(movements: StockMovement[], landedOf: (productId: string) => Paise, istDay: string, scope: ShopScope): { value: Paise; items: number } {
  const end = istDayStart(addIstDays(istDay, 1));
  const byProduct = new Map<string, number>();
  for (const m of movements) {
    if (m.at >= end || !inScope(m.storeCode, scope)) continue;
    byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.qty);
  }
  let value = 0;
  let items = 0;
  for (const [productId, qty] of byProduct) {
    value += qty * landedOf(productId);
    if (qty > 0) items += 1;
  }
  return { value, items };
}

export interface SheetRow {
  productId: string;
  opening: number;
  /** Everything that came in on the day: deliveries, transfers in, positive corrections. */
  in: number;
  /** Everything that went out: sales (net of voids), transfers out, losses, negative corrections. */
  out: number;
  closing: number;
  mrp: Paise;
}

/** The Daily Sheet of the scope for an IST day, one row per product with something to show, busiest first. */
export function sheetRows(
  movements: StockMovement[],
  products: Map<string, Product>,
  mrpOf: (productId: string) => Paise,
  istDay: string,
  scope: ShopScope,
  kind: 'all' | 'alc' | 'other',
): SheetRow[] {
  const byShop = new Map<string, StockMovement[]>();
  for (const m of movements) {
    if (!inScope(m.storeCode, scope)) continue;
    const list = byShop.get(m.storeCode);
    if (list) list.push(m);
    else byShop.set(m.storeCode, [m]);
  }
  const rows = new Map<string, SheetRow>();
  for (const [shop, list] of byShop) {
    for (const [productId, f] of stockFlows(list, shop, istDay, istDay)) {
      const p = products.get(productId);
      if (!p || (kind === 'alc' && p.materialType !== 'ALC') || (kind === 'other' && p.materialType === 'ALC')) continue;
      const row = rows.get(productId) ?? { productId, opening: 0, in: 0, out: 0, closing: 0, mrp: mrpOf(productId) };
      row.opening += f.opening;
      row.in += f.received;
      row.out += f.issued;
      row.closing += f.closing;
      rows.set(productId, row);
    }
  }
  return [...rows.values()]
    .filter((r) => r.opening !== 0 || r.in !== 0 || r.out !== 0 || r.closing !== 0)
    .sort((a, b) => b.out - a.out || (a.productId < b.productId ? -1 : 1));
}

export interface FeedRow {
  number: string;
  at: string;
  storeCode: string;
  counter: number;
  net: Paise;
  items: number;
}

/** The newest paid bills, newest first. `itemCounts` is items (bottles) per bill number. */
export function liveFeed(bills: Bill[], itemCounts: Map<string, number>, scope: ShopScope, n = 30): FeedRow[] {
  return bills
    .filter((b) => b.status === 'paid' && inScope(b.storeCode, scope))
    .sort((a, b) => (a.at === b.at ? (a.number < b.number ? 1 : -1) : a.at < b.at ? 1 : -1))
    .slice(0, n)
    .map((b) => ({ number: b.number, at: b.at, storeCode: b.storeCode, counter: b.counter, net: b.net, items: itemCounts.get(b.number) ?? 0 }));
}

export interface MovedFigure {
  qty: number;
  /** Distinct deliveries or transfers behind the quantity. */
  count: number;
}

export interface StockMoved {
  ksbcl: MovedFigure;
  other: MovedFigure;
  transferOut: MovedFigure;
  transferIn: MovedFigure;
}

/** What moved on an IST day, read from the ledger: deliveries by supplier kind, and transfers out and in. */
export function stockMoved(movements: StockMovement[], grnType: (ref: string) => Grn['type'] | undefined, istDay: string, scope: ShopScope): StockMoved {
  const [from, to] = dayBounds(istDay);
  const sums = { ksbcl: new Map<string, number>(), other: new Map<string, number>(), transferOut: new Map<string, number>(), transferIn: new Map<string, number>() };
  const add = (bucket: Map<string, number>, ref: string, qty: number): void => {
    bucket.set(ref, (bucket.get(ref) ?? 0) + qty);
  };
  for (const m of movements) {
    if (m.at < from || m.at >= to || !inScope(m.storeCode, scope)) continue;
    if (m.kind === 'purchase') add(grnType(m.ref) === 'ksbcl' ? sums.ksbcl : sums.other, m.ref, m.qty);
    else if (m.kind === 'transfer_out') add(sums.transferOut, m.ref, -m.qty);
    else if (m.kind === 'transfer_in') add(sums.transferIn, m.ref, m.qty);
  }
  const figure = (bucket: Map<string, number>): MovedFigure => ({ qty: [...bucket.values()].reduce((s, q) => s + q, 0), count: bucket.size });
  return { ksbcl: figure(sums.ksbcl), other: figure(sums.other), transferOut: figure(sums.transferOut), transferIn: figure(sums.transferIn) };
}

export interface ReceiptRow {
  id: string;
  invoiceNo: string;
  at: string;
  storeCode: string;
  type: Grn['type'];
  /** True when any line is an alcoholic product. */
  alcohol: boolean;
  /** Cases received (the counted bottles, or the invoiced ones until counted), one decimal. */
  cases: number;
  /** The product when the delivery is one product, else null ("mixed"). */
  productId: string | null;
  amount: Paise;
}

export interface TransferRow {
  id: string;
  at: string;
  fromStore: string;
  toStore: string;
  qty: number;
  /** For one shop: `out` (stock lost) or `in` (stock gained). For all shops: `between`. */
  direction: 'out' | 'in' | 'between';
}

export interface PurchasesSummary {
  ksbcl: Paise;
  other: Paise;
  /** Deliveries received in the month. */
  entries: number;
  receipts: ReceiptRow[];
  transfers: TransferRow[];
  suppliers: { supplierId: string; name: string; receipts: number; amount: Paise }[];
}

/** The month's deliveries (received GRNs) and transfers for the scope. `month` is an IST month, `2026-10`. */
export function purchasesSummary(input: { grns: Grn[]; transfers: Transfer[]; products: Map<string, Product>; suppliers: Supplier[]; scope: ShopScope; month: string }): PurchasesSummary {
  const { products, scope, month } = input;
  const received = input.grns.filter((g) => g.status === 'received' && inScope(g.storeCode, scope) && istDate(g.receivedAt).startsWith(month));
  const receipts: ReceiptRow[] = received
    .map((g) => {
      const ids = [...new Set(g.lines.map((l) => l.productId))];
      const cases = g.lines.reduce((s, l) => s + (l.counted ?? l.expected) / (products.get(l.productId)?.caseSize || 1), 0);
      return {
        id: g.id,
        invoiceNo: g.invoiceNo,
        at: g.receivedAt,
        storeCode: g.storeCode,
        type: g.type,
        alcohol: g.lines.some((l) => products.get(l.productId)?.materialType === 'ALC'),
        cases: Math.round(cases * 10) / 10,
        productId: ids.length === 1 ? ids[0] : null,
        amount: g.invoiceAmount,
      };
    })
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));

  const transfers: TransferRow[] = [];
  for (const t of input.transfers) {
    const at = t.dispatchedAt ?? t.receivedAt;
    if (t.status === 'draft' || !at || !istDate(at).startsWith(month)) continue;
    if (scope !== null && t.fromStore !== scope && t.toStore !== scope) continue;
    const direction = scope === null ? 'between' : t.fromStore === scope ? 'out' : 'in';
    if (direction === 'in' && t.status !== 'received') continue; // not yet in the shop's stock
    transfers.push({ id: t.id, at, fromStore: t.fromStore, toStore: t.toStore, qty: t.lines.reduce((s, l) => s + l.qty, 0), direction });
  }
  transfers.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));

  const bySupplier = new Map<string, { supplierId: string; name: string; receipts: number; amount: Paise }>();
  const nameOf = new Map(input.suppliers.map((s) => [s.id, s.name]));
  for (const g of received) {
    const row = bySupplier.get(g.supplierId) ?? { supplierId: g.supplierId, name: nameOf.get(g.supplierId) ?? g.supplierId, receipts: 0, amount: 0 };
    row.receipts += 1;
    row.amount += g.invoiceAmount;
    bySupplier.set(g.supplierId, row);
  }
  return {
    ksbcl: received.filter((g) => g.type === 'ksbcl').reduce((s, g) => s + g.invoiceAmount, 0),
    other: received.filter((g) => g.type !== 'ksbcl').reduce((s, g) => s + g.invoiceAmount, 0),
    entries: received.length,
    receipts,
    transfers,
    suppliers: [...bySupplier.values()].sort((a, b) => b.amount - a.amount || (a.supplierId < b.supplierId ? -1 : 1)),
  };
}

/** The month so far, 1st to the day: store total, bills and discount. */
export function monthSales(bills: Bill[], scope: ShopScope, istDay: string): { net: Paise; bills: number; discount: Paise } {
  const month = paidBetween(bills, scope, istDayStart(`${istDay.slice(0, 8)}01`), istDayStart(addIstDays(istDay, 1)));
  return { net: month.reduce((s, b) => s + b.net, 0), bills: month.length, discount: month.reduce((s, b) => s + b.discount, 0) };
}

export interface BrandSales {
  brand: string;
  units: number;
  amount: Paise;
}

/** Sales by brand between two IST days (both included), biggest first. */
export function brandSales(bills: Bill[], lines: BillLine[], products: Map<string, Product>, scope: ShopScope, fromDay: string, toDay: string): BrandSales[] {
  const numbers = new Set(paidBetween(bills, scope, istDayStart(fromDay), istDayStart(addIstDays(toDay, 1))).map((b) => b.number));
  const by = new Map<string, BrandSales>();
  for (const l of lines) {
    const p = numbers.has(l.billNumber) ? products.get(l.productId) : undefined;
    if (!p) continue;
    const row = by.get(p.brand) ?? { brand: p.brand, units: 0, amount: 0 };
    row.units += l.qty;
    row.amount += l.amount;
    by.set(p.brand, row);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount || (a.brand < b.brand ? -1 : 1));
}

/** Per offer code: how many bills it touched and how much discount it gave. */
export function offerImpact(rows: DiscountRow[]): Map<string, { bills: number; discount: Paise }> {
  const bills = new Map<string, Set<string>>();
  const out = new Map<string, { bills: number; discount: Paise }>();
  for (const r of rows) {
    const seen = bills.get(r.offerCode) ?? new Set<string>();
    seen.add(r.billNumber);
    bills.set(r.offerCode, seen);
    out.set(r.offerCode, { bills: seen.size, discount: (out.get(r.offerCode)?.discount ?? 0) + r.discount });
  }
  return out;
}

/** How long ago, in the largest whole unit: seconds below a minute, then minutes, hours, days. */
export function ageParts(ms: number): { n: number; unit: 's' | 'm' | 'h' | 'd' } {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return { n: s, unit: 's' };
  if (s < 3600) return { n: Math.floor(s / 60), unit: 'm' };
  if (s < 86400) return { n: Math.floor(s / 3600), unit: 'h' };
  return { n: Math.floor(s / 86400), unit: 'd' };
}
