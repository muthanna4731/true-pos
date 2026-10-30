import { t } from '../i18n';
import { avgDailySales, minLevel } from './orders';
import { onHandMap } from './stock';
import { istDate, istDayStart } from './time';
import type { Bill, Claim, Count, DayClose, Grn, Product, StockMovement, Store, Transfer } from './types';

export type TodoKind = 'low_stock' | 'delivery_short' | 'transfer_stuck' | 'negative_stock' | 'count_off' | 'beer_expiry' | 'day_not_closed';

export interface Todo {
  kind: TodoKind;
  /** The shop it is about; `ALL` when several shops share one item. */
  storeCode: string;
  /** What it is about (product, delivery, transfer...), so one item has one stable key. */
  ref: string;
  text: string;
  action: { label: string; to: string };
}

export interface TodoInput {
  stores: Store[];
  products: Product[];
  movements: StockMovement[];
  grns: Grn[];
  transfers: Transfer[];
  counts: Count[];
  dayCloses: DayClose[];
  bills: Bill[];
  /** A short delivery stays on the list until its claim is filed. */
  claims?: Claim[];
  nowIso: string;
}

const DAY_MS = 86400000;
/** A count is "off" when it differs by more than this many bottles. */
const COUNT_TOLERANCE = 2;
const COUNT_LOOKBACK_DAYS = 7;
const EXPIRY_WARN_DAYS = 30;

/** `TS1` for shop 01, `TS10` for the tenth. */
export function shopLabel(store: Store | undefined, fallback: string): string {
  return store ? `TS${Number(store.number)}` : fallback;
}

const plural = (n: number, one: string, many: string): string => t(n === 1 ? one : many, { n });

/** Bottles as "2 cases" when every line is whole cases, else as bottles. */
function quantityText(lines: { bottles: number; caseSize: number }[]): string {
  if (lines.every((l) => l.bottles % l.caseSize === 0)) {
    return plural(lines.reduce((s, l) => s + l.bottles / l.caseSize, 0), 'todo.case', 'todo.cases');
  }
  return plural(lines.reduce((s, l) => s + l.bottles, 0), 'todo.bottle', 'todo.bottles');
}

/** Whole IST calendar days from one instant to another, at least 1. */
function istDaysBetween(fromIso: string, toIso: string): number {
  const diff = new Date(istDayStart(istDate(toIso))).getTime() - new Date(istDayStart(istDate(fromIso))).getTime();
  return Math.max(1, Math.round(diff / DAY_MS));
}

/**
 * Everything that needs the office today, worked out from the records alone, so an item disappears when its cause
 * is fixed. Low stock only looks at products that sell at that shop (a recent average above 0).
 */
export function generateTodos(input: TodoInput): Todo[] {
  const { nowIso } = input;
  const storeBy = new Map(input.stores.map((s) => [s.code, s]));
  const productBy = new Map(input.products.map((p) => [p.id, p]));
  const shop = (code: string): string => shopLabel(storeBy.get(code), code);
  const name = (productId: string): string => productBy.get(productId)?.shortName ?? productId;
  const stock = onHandMap(input.movements);
  const todos: Todo[] = [];

  // Low stock, grouped per product.
  const lowShops = new Map<string, string[]>();
  for (const [key, avg] of avgDailySales(input.movements, nowIso)) {
    if (avg <= 0 || (stock.get(key) ?? 0) >= minLevel(avg)) continue;
    const [store, productId] = key.split('|');
    lowShops.set(productId, [...(lowShops.get(productId) ?? []), store]);
  }
  [...lowShops]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .forEach(([productId, shops]) => {
      todos.push({
        kind: 'low_stock',
        storeCode: shops.length === 1 ? shops[0] : 'ALL',
        ref: productId,
        text: shops.length === 1 ? t('todo.lowOne', { shop: shop(shops[0]), name: name(productId) }) : t('todo.lowMany', { n: shops.length, name: name(productId) }),
        action: { label: t('todo.act.order'), to: '/office/orders' },
      });
    });

  // Short or broken deliveries with no claim filed yet.
  const filed = new Set((input.claims ?? []).filter((c) => c.status !== 'open').map((c) => `${c.grnId}|${c.productId}`));
  for (const g of input.grns) {
    if (g.status !== 'received') continue;
    const bad = g.lines.filter((l) => (l.short ?? 0) > 0 || (l.broken ?? 0) > 0);
    if (bad.length === 0 || bad.every((l) => filed.has(`${g.id}|${l.productId}`))) continue;
    const sized = (pick: (l: Grn['lines'][number]) => number) =>
      bad.filter((l) => pick(l) > 0).map((l) => ({ bottles: pick(l), caseSize: productBy.get(l.productId)?.caseSize ?? 1 }));
    const short = sized((l) => l.short ?? 0);
    const broken = sized((l) => l.broken ?? 0);
    const what = [
      ...(short.length ? [t('todo.short', { q: quantityText(short) })] : []),
      ...(broken.length ? [t('todo.broken', { q: quantityText(broken) })] : []),
    ].join(', ');
    todos.push({
      kind: 'delivery_short',
      storeCode: g.storeCode,
      ref: g.id,
      text: t('todo.deliveryShort', { shop: shop(g.storeCode), what }),
      action: { label: t('todo.act.claim'), to: `/office/deliveries?grn=${g.id}` },
    });
  }

  // Transfers in transit for more than 24 hours.
  const nowMs = new Date(nowIso).getTime();
  for (const tr of input.transfers) {
    if (tr.status !== 'in_transit' || !tr.dispatchedAt || nowMs - new Date(tr.dispatchedAt).getTime() <= DAY_MS) continue;
    todos.push({
      kind: 'transfer_stuck',
      storeCode: tr.toStore,
      ref: tr.id,
      text: t('todo.transferStuck', { id: tr.id, days: plural(istDaysBetween(tr.dispatchedAt, nowIso), 'todo.day', 'todo.days') }),
      action: { label: t('todo.act.call'), to: '/office/transfers' },
    });
  }

  // Negative stock.
  for (const [key, qty] of stock) {
    if (qty >= 0) continue;
    const [store, productId] = key.split('|');
    todos.push({
      kind: 'negative_stock',
      storeCode: store,
      ref: key,
      text: t('todo.negative', { name: name(productId), n: `−${-qty}`, shop: shop(store) }),
      action: { label: t('todo.act.count'), to: '/office/stock' },
    });
  }

  // Counts off by more than the allowed amount in the last 7 days, unless a later count of the same product was fine.
  const since = new Date(new Date(istDayStart(istDate(nowIso))).getTime() - (COUNT_LOOKBACK_DAYS - 1) * DAY_MS).toISOString();
  const latestCount = new Map<string, string>();
  for (const c of input.counts) {
    for (const l of c.lines) {
      const key = `${c.storeCode}|${l.productId}`;
      if ((latestCount.get(key) ?? '') < c.at) latestCount.set(key, c.at);
    }
  }
  for (const c of input.counts) {
    if (c.at < since) continue;
    const off = c.lines
      .filter((l) => Math.abs(l.counted - l.system) > COUNT_TOLERANCE && latestCount.get(`${c.storeCode}|${l.productId}`) === c.at)
      .sort((a, b) => Math.abs(b.counted - b.system) - Math.abs(a.counted - a.system));
    if (off.length === 0) continue;
    const diff = off[0].counted - off[0].system;
    const worst = t('todo.countOff', { shop: shop(c.storeCode), name: name(off[0].productId), diff: diff < 0 ? `−${-diff}` : `+${diff}` });
    todos.push({
      kind: 'count_off',
      storeCode: c.storeCode,
      ref: c.id,
      text: off.length > 1 ? `${worst} ${t('todo.more', { n: off.length - 1 })}` : worst,
      action: { label: t('todo.act.check'), to: '/office/stock' },
    });
  }

  // Beer lots within 30 days of expiry that still have stock. Sales take the oldest lot first, so the newest lots hold what is left.
  const today = istDate(nowIso);
  const limit = istDate(new Date(nowMs + EXPIRY_WARN_DAYS * DAY_MS).toISOString());
  const lotsByPair = new Map<string, Map<string, number>>();
  for (const m of input.movements) {
    if (!m.expiresOn || m.qty <= 0) continue;
    const key = `${m.storeCode}|${m.productId}`;
    const lots = lotsByPair.get(key) ?? new Map<string, number>();
    lots.set(m.expiresOn, (lots.get(m.expiresOn) ?? 0) + m.qty);
    lotsByPair.set(key, lots);
  }
  for (const [key, lots] of lotsByPair) {
    const [store, productId] = key.split('|');
    if (productBy.get(productId)?.category !== 'BEER') continue;
    let remaining = Math.max(0, stock.get(key) ?? 0);
    for (const [expiresOn, qty] of [...lots].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      const left = Math.min(qty, remaining);
      remaining -= left;
      if (left <= 0 || expiresOn > limit) continue;
      const days = Math.round((new Date(istDayStart(expiresOn)).getTime() - new Date(istDayStart(today)).getTime()) / DAY_MS);
      todos.push({
        kind: 'beer_expiry',
        storeCode: store,
        ref: `${key}|${expiresOn}`,
        text: days > 0 ? t('todo.beerExpiry', { name: name(productId), shop: shop(store), n: days }) : t('todo.beerExpired', { name: name(productId), shop: shop(store) }),
        action: { label: t('todo.act.move'), to: '/office/stock' },
      });
    }
  }

  // Shops that sold yesterday but did not lock the day.
  const yesterday = istDate(new Date(new Date(istDayStart(today)).getTime() - 1).toISOString());
  const closed = new Set(input.dayCloses.filter((d) => d.date === yesterday).map((d) => d.storeCode));
  const sold = new Set(input.bills.filter((b) => b.status === 'paid' && istDate(b.at) === yesterday).map((b) => b.storeCode));
  for (const s of input.stores) {
    if (!sold.has(s.code) || closed.has(s.code)) continue;
    todos.push({
      kind: 'day_not_closed',
      storeCode: s.code,
      ref: `${s.code}|${yesterday}`,
      text: t('todo.dayNotClosed', { shop: shop(s.code) }),
      action: { label: t('todo.act.remind'), to: '/office/shops' },
    });
  }

  return todos;
}
