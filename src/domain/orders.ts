import { istDate, istDayStart } from './time';
import { onHandMap } from './stock';
import type { Grn, Indent, Paise, Price, Product, StockMovement } from './types';

/**
 * Reorder level in bottles: three days of average sales, never below 6.
 * `avgDaily` is the product's average bottles sold per day.
 */
export function minLevel(avgDaily: number): number {
  return Math.max(6, Math.ceil(3 * avgDaily));
}

/** What a KSBCL indent number looks like: `IND`, three letters for the depot, eight digits. */
export const INDENT_RE = /^IND[A-Z]{3}\d{8}$/;

/** What a KSBCL invoice number looks like: `S`, three letters for the depot, eight digits. */
export const KSBCL_INV_RE = /^S[A-Z]{3}\d{8}$/;

/** Cases to order so `minDays` of average sales are covered by what is on the shelf and on order. Never below 0. */
export function suggestedOrderCases(x: { avgDaily: number; minDays: number; onHand: number; onOrder: number; caseSize: number }): number {
  return Math.max(0, Math.ceil((x.minDays * x.avgDaily - x.onHand - x.onOrder) / x.caseSize));
}

/** Days of sales the average is taken over. */
const AVG_DAYS = 7;

/**
 * Average bottles sold per day for each store and product (key `store|product`): sales net of voids over the
 * 7 IST days before today. Today is left out, so the figure does not change through the day.
 */
export function avgDailySales(movements: StockMovement[], nowIso: string): Map<string, number> {
  const todayStart = new Date(istDayStart(istDate(nowIso))).getTime();
  const from = new Date(todayStart - AVG_DAYS * 86400000).toISOString();
  const to = new Date(todayStart).toISOString();
  const sold = new Map<string, number>();
  for (const m of movements) {
    if ((m.kind !== 'sale' && m.kind !== 'void') || m.at < from || m.at >= to) continue;
    const key = `${m.storeCode}|${m.productId}`;
    sold.set(key, (sold.get(key) ?? 0) - m.qty);
  }
  return new Map([...sold].map(([key, units]) => [key, units / AVG_DAYS]));
}

/** An order that is out with KSBCL: placed, paid or dispatched, not yet booked in. */
export const isOnOrder = (i: Indent): boolean => i.status === 'placed' || i.status === 'paid' || i.status === 'dispatched';

export interface SuggestedLine {
  productId: string;
  cases: number;
  onHand: number;
  onOrder: number;
  avgDaily: number;
}

/**
 * The suggested KSBCL order for `storeCodes` (one shop, or every shop for the hub, which orders for them all):
 * seven days of sales less stock and open orders, in whole cases. Only products that sell, and only when cases > 0.
 */
export function suggestOrder(x: {
  movements: StockMovement[];
  products: Product[];
  indents: Indent[];
  storeCodes: string[];
  nowIso: string;
  minDays?: number;
}): SuggestedLine[] {
  const stores = new Set(x.storeCodes);
  const avg = avgDailySales(x.movements, x.nowIso);
  const stock = onHandMap(x.movements);
  const caseSize = new Map(x.products.map((p) => [p.id, p.caseSize]));
  const perProduct = new Map<string, { avgDaily: number; onHand: number; onOrder: number }>();
  const row = (productId: string) => {
    let r = perProduct.get(productId);
    if (!r) perProduct.set(productId, (r = { avgDaily: 0, onHand: 0, onOrder: 0 }));
    return r;
  };
  for (const [key, avgDaily] of avg) {
    const [store, productId] = key.split('|');
    if (stores.has(store) && avgDaily > 0) {
      row(productId).avgDaily += avgDaily;
      row(productId).onHand += stock.get(key) ?? 0;
    }
  }
  for (const i of x.indents) {
    if (!stores.has(i.storeCode) || !isOnOrder(i)) continue;
    for (const l of i.lines) if (perProduct.has(l.productId)) row(l.productId).onOrder += l.cases * (caseSize.get(l.productId) ?? 1);
  }
  const out: SuggestedLine[] = [];
  for (const [productId, r] of perProduct) {
    const cases = suggestedOrderCases({ ...r, minDays: x.minDays ?? 7, caseSize: caseSize.get(productId) ?? 1 });
    if (cases > 0) out.push({ productId, cases, ...r });
  }
  return out.sort((a, b) => b.cases - a.cases || a.productId.localeCompare(b.productId));
}

/** AROED and the invoice total of a delivery: AROED from the price in force on the day it came, total = invoice + AROED + TCS. */
export function grnTotals(grn: Grn, prices: Price[]): { aroed: Paise; total: Paise } {
  const day = istDate(grn.receivedAt);
  const best = new Map<string, Price>();
  for (const p of prices) {
    if (p.effectiveFrom > day) continue;
    const have = best.get(p.productId);
    if (!have || p.effectiveFrom > have.effectiveFrom) best.set(p.productId, p);
  }
  const aroed = grn.lines.reduce((s, l) => s + l.expected * (best.get(l.productId)?.aroed ?? 0), 0);
  return { aroed, total: grn.invoiceAmount + aroed + grn.tcs };
}

/**
 * Bottles to send from the hub to a shop that is running low: for every product the shop sells whose stock is under
 * its reorder level, fill up to twice that level, never more than the hub has. Products the hub cannot spare are left out.
 * `sales` is `avgDailySales(...)` (key `store|product`).
 */
export function refillSuggestion(
  storeCode: string,
  hubCode: string,
  movements: StockMovement[],
  sales: Map<string, number>,
): { productId: string; qty: number }[] {
  const stock = onHandMap(movements);
  const out: { productId: string; qty: number }[] = [];
  for (const [key, avg] of sales) {
    const [store, productId] = key.split('|');
    if (store !== storeCode || avg <= 0) continue;
    const level = minLevel(avg);
    const have = stock.get(key) ?? 0;
    if (have >= level) continue;
    const qty = Math.min(2 * level - have, stock.get(`${hubCode}|${productId}`) ?? 0);
    if (qty > 0) out.push({ productId, qty });
  }
  return out.sort((a, b) => a.productId.localeCompare(b.productId));
}
