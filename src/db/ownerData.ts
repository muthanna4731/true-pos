import Dexie from 'dexie';
import { addIstDays, clock, istDate, istDayStart } from '../domain/time';
import { chainMonthToDate, rankProducts, shopSummaries, type ShopScope } from '../domain/owner';
import { priceRowsInForce } from '../domain/prices';
import { generateTodos } from '../domain/todos';
import type { Bill, BillLine, Product, StockMovement, Store } from '../domain/types';
import { db } from './db';

/*
 * The owner app's reads. Each loader reads only what its screen needs through the `[storeCode+at]` indexes
 * (never the whole bill history) and hands plain records to the pure figures in `domain/owner.ts`.
 */

const range = (from: string, to: string) => (code: string) => db.bills.where('[storeCode+at]').between([code, from], [code, to], true, false).toArray();

/** The shops a scope covers. */
export const codesFor = (stores: Store[], scope: ShopScope): string[] => (scope === null ? stores.map((s) => s.code) : stores.filter((s) => s.code === scope).map((s) => s.code));

/** Bills of the shops with `from <= at < to`. */
async function billsBetween(codes: string[], from: string, to: string): Promise<Bill[]> {
  return (await Promise.all(codes.map(range(from, to)))).flat();
}

/** One shop's whole ledger, newest included. */
const ledger = (code: string): Promise<StockMovement[]> => db.movements.where('[storeCode+at]').between([code, Dexie.minKey], [code, Dexie.maxKey]).toArray();

async function movementsOf(codes: string[]): Promise<StockMovement[]> {
  return (await Promise.all(codes.map(ledger))).flat();
}

const productMap = async (): Promise<Map<string, Product>> => new Map((await db.products.toArray()).map((p) => [p.id, p]));

/**
 * The day the owner app shows: today, or yesterday while no shop has rung a paid bill today, so the app is never a
 * wall of zeros first thing in the morning. It looks at every shop, so the day does not change with the shop picked.
 */
export async function ownerDay(stores: Store[]): Promise<{ today: string; day: string }> {
  const today = istDate(clock.now());
  const start = istDayStart(today);
  const end = istDayStart(addIstDays(today, 1));
  const counts = await Promise.all(stores.map((s) => db.bills.where('[storeCode+at]').between([s.code, start], [s.code, end], true, false).filter((b) => b.status === 'paid').count()));
  return { today, day: counts.some((n) => n > 0) ? today : addIstDays(today, -1) };
}

/** The time of the newest paid bill of the shops, or null when there is none. */
async function newestPaidAt(codes: string[]): Promise<string | null> {
  const newest = await Promise.all(
    codes.map((c) => db.bills.where('[storeCode+at]').between([c, Dexie.minKey], [c, Dexie.maxKey]).reverse().filter((b) => b.status === 'paid').first()),
  );
  return newest.reduce<string | null>((best, b) => (b && (best === null || b.at > best) ? b.at : best), null);
}

export interface TodayData {
  /** The scope this was read for, so a screen can tell stale data (from the shop picked before) from fresh. */
  scope: ShopScope;
  day: string;
  stores: Store[];
  products: Map<string, Product>;
  /** Bills of the day and the 7 days before it. */
  bills: Bill[];
  /** The day's lines, plus every line of the three best sellers (for their weekly sparkline). */
  lines: BillLine[];
  movements: StockMovement[];
  newestAt: string | null;
}

export async function loadToday(scope: ShopScope): Promise<TodayData> {
  const stores = await db.stores.toArray();
  const { day } = await ownerDay(stores);
  const codes = codesFor(stores, scope);
  const dayStart = istDayStart(day);
  const bills = await billsBetween(codes, istDayStart(addIstDays(day, -7)), istDayStart(addIstDays(day, 1)));
  const todays = bills.filter((b) => b.status === 'paid' && b.at >= dayStart).map((b) => b.number);
  const dayLines = await db.billLines.where('billNumber').anyOf(todays).toArray();
  const top = rankProducts(bills, dayLines, day, scope).map((r) => r.productId);
  const topLines = top.length > 0 ? await db.billLines.where('productId').anyOf(top).toArray() : [];
  const seen = new Set<number | undefined>();
  const lines = [...dayLines, ...topLines].filter((l) => l.id === undefined || (!seen.has(l.id) && seen.add(l.id)));
  const [products, movements, newestAt] = await Promise.all([productMap(), movementsOf(codes), newestPaidAt(codes)]);
  return { scope, day, stores, products, bills, lines, movements, newestAt };
}

export interface SalesData {
  scope: ShopScope;
  day: string;
  stores: Store[];
  /** The newest paid bills (up to 30 per shop) and every bill of the current hour. */
  bills: Bill[];
  itemCounts: Map<string, number>;
  movements: StockMovement[];
  grnTypes: Map<string, 'ksbcl' | 'other'>;
}

/** `hourStart` is the top of the current IST hour (a changing dependency, so the query reruns when it rolls over). */
export async function loadSales(scope: ShopScope, hourStart: string): Promise<SalesData> {
  const stores = await db.stores.toArray();
  const { day } = await ownerDay(stores);
  const codes = codesFor(stores, scope);
  const newest = (
    await Promise.all(codes.map((c) => db.bills.where('[storeCode+at]').between([c, Dexie.minKey], [c, Dexie.maxKey]).reverse().filter((b) => b.status === 'paid').limit(30).toArray()))
  ).flat();
  const hourBills = await billsBetween(codes, hourStart, new Date(Date.parse(hourStart) + 3600000).toISOString());
  const bills = [...new Map([...newest, ...hourBills].map((b) => [b.number, b])).values()];
  const shown = newest.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30).map((b) => b.number);
  const lines = await db.billLines.where('billNumber').anyOf(shown).toArray();
  const itemCounts = new Map<string, number>();
  for (const l of lines) itemCounts.set(l.billNumber, (itemCounts.get(l.billNumber) ?? 0) + l.qty);
  const [from, to] = [istDayStart(day), istDayStart(addIstDays(day, 1))];
  const movements = (await Promise.all(codes.map((c) => db.movements.where('[storeCode+at]').between([c, from], [c, to], true, false).toArray()))).flat();
  const grns = await db.grns.toArray();
  return { scope, day, stores, bills, itemCounts, movements, grnTypes: new Map(grns.map((g) => [g.id, g.type])) };
}

export interface StockData {
  scope: ShopScope;
  day: string;
  stores: Store[];
  products: Map<string, Product>;
  movements: StockMovement[];
  mrpOf: (productId: string) => number;
  landedOf: (productId: string) => number;
}

export async function loadStock(scope: ShopScope): Promise<StockData> {
  const stores = await db.stores.toArray();
  const { day } = await ownerDay(stores);
  const [products, movements, prices] = await Promise.all([productMap(), movementsOf(codesFor(stores, scope)), db.prices.toArray()]);
  const inForce = priceRowsInForce(prices, day);
  return {
    scope,
    day,
    stores,
    products,
    movements,
    mrpOf: (id) => inForce.get(id)?.mrp ?? 0,
    landedOf: (id) => (inForce.get(id)?.purchase ?? 0) + (inForce.get(id)?.aroed ?? 0),
  };
}

export async function loadPurchases(scope: ShopScope) {
  const [stores, products, grns, transfers, suppliers] = await Promise.all([db.stores.toArray(), productMap(), db.grns.toArray(), db.transfers.toArray(), db.suppliers.toArray()]);
  const { day } = await ownerDay(stores);
  return { scope, day, stores, products, grns: grns.filter((g) => scope === null || g.storeCode === scope), transfers, suppliers };
}

export async function loadReports(scope: ShopScope) {
  const stores = await db.stores.toArray();
  const { day } = await ownerDay(stores);
  const codes = codesFor(stores, scope);
  const bills = await billsBetween(codes, istDayStart(`${day.slice(0, 8)}01`), istDayStart(addIstDays(day, 1)));
  const lines = await db.billLines.where('billNumber').anyOf(bills.filter((b) => b.status === 'paid').map((b) => b.number)).toArray();
  const [products, offers] = await Promise.all([productMap(), db.offers.toArray()]);
  return { scope, day, stores, bills, lines, products, offers };
}

/** Per-shop figures for one IST day (the picked one, else the owner app's day) and the chain month to date, for the shops list and the nightly summary. */
export async function loadShopSummaries(picked: string | null) {
  const stores = await db.stores.toArray();
  const day = picked ?? (await ownerDay(stores)).day;
  const monthStart = istDayStart(`${day.slice(0, 8)}01`);
  const dayEnd = istDayStart(addIstDays(day, 1));
  const nowIso = clock.now();
  const [movements, shifts, dayCloses] = await Promise.all([db.movements.toArray(), db.shifts.toArray(), db.dayCloses.toArray()]);
  const bills = await billsBetween(stores.map((s) => s.code), monthStart, dayEnd);
  // Payments only for the day's bills: the month's are only needed for the chain total, which needs no payment split.
  const numbers = bills.filter((b) => b.status === 'paid' && istDate(b.at) === day).map((b) => b.number);
  const payments = await db.payments.where('billNumber').anyOf(numbers).toArray();
  const [products, grns, transfers, counts, claims] = await Promise.all([db.products.toArray(), db.grns.toArray(), db.transfers.toArray(), db.counts.toArray(), db.claims.toArray()]);
  const todos = generateTodos({ stores, products, movements, grns, transfers, counts, dayCloses, bills, claims, nowIso });
  return { day, rows: shopSummaries({ stores, bills, payments, shifts, dayCloses, todos, movements, istDay: day, nowIso }), chain: chainMonthToDate(bills, day) };
}
