import { exciseGroup } from './catalogue';
import { productMap, stockFlows, type ProductSource } from './stock';
import { formatTime, istDate } from './time';
import { typeOf } from './productType';
import { t } from '../i18n';
import type { Bill, BillLine, ExciseGroup, Loss, Offer, PayMode, Paise, Payment, Product, StockMovement } from './types';

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

// ---- stock reports, all read from the movement ledger -------------------------------------------

/** Litres rounded to 2 decimals: bottles x size in ml. */
function litresOf(ml: number): number {
  return Math.round(ml / 10) / 100;
}

const mlOf = (qty: number, p: Product): number => qty * (p.sizeMl ?? 0);

/** Quantity, litres and amount (at cost) of one figure. */
export interface QLA {
  qty: number;
  litres: number;
  amount: Paise;
}

export interface ExciseRow {
  productId: string;
  group: ExciseGroup;
  opening: QLA;
  received: QLA;
  issued: QLA;
  closing: QLA;
}

/**
 * The excise litre statement for a range of IST days: per alcoholic product, opening, received, issued and closing
 * in bottles, litres and landed cost (`costOf` = purchase + AROED). Non-alcoholic products are left out.
 * Wine is in the IML group.
 */
export function exciseLitreStatement(
  movements: StockMovement[],
  products: ProductSource,
  costOf: (productId: string) => Paise,
  storeCode: string,
  fromDay: string,
  toDay: string,
): ExciseRow[] {
  const known = productMap(products);
  const rows: ExciseRow[] = [];
  for (const [productId, f] of stockFlows(movements, storeCode, fromDay, toDay)) {
    const p = known.get(productId);
    const group = p && exciseGroup(p);
    if (!p || !group) continue;
    if (f.opening === 0 && f.received === 0 && f.issued === 0 && f.closing === 0) continue;
    const cost = costOf(productId);
    const qla = (qty: number): QLA => ({ qty, litres: litresOf(mlOf(qty, p)), amount: qty * cost });
    rows.push({ productId, group, opening: qla(f.opening), received: qla(f.received), issued: qla(f.issued), closing: qla(f.closing) });
  }
  return rows;
}

export interface LitreRow {
  group: ExciseGroup | 'Grand Total';
  opening: number;
  /** Purchases less returns. Transfers and count corrections are in `total` and `closing` only. */
  purchase: number;
  /** Opening + purchases + transfers in - transfers out. */
  total: number;
  sales: number;
  closing: number;
}

/** One IST day in litres: a BEER line, an IML line (wine inside) and a Grand Total. Non-alcoholic products are left out. */
export function dailyLitreStatement(movements: StockMovement[], products: ProductSource, storeCode: string, istDay: string): LitreRow[] {
  const known = productMap(products);
  const ml = (): Record<'opening' | 'purchase' | 'total' | 'sales' | 'closing', number> => ({ opening: 0, purchase: 0, total: 0, sales: 0, closing: 0 });
  const sums: Record<ExciseGroup, ReturnType<typeof ml>> = { BEER: ml(), IML: ml() };
  for (const [productId, f] of stockFlows(movements, storeCode, istDay, istDay)) {
    const p = known.get(productId);
    const group = p && exciseGroup(p);
    if (!p || !group) continue;
    const s = sums[group];
    s.opening += mlOf(f.opening, p);
    s.purchase += mlOf(f.purchase, p);
    s.total += mlOf(f.opening + f.purchase + f.transferIn - f.transferOut, p);
    s.sales += mlOf(f.sales, p);
    s.closing += mlOf(f.closing, p);
  }
  const line = (group: ExciseGroup): LitreRow => ({
    group,
    opening: litresOf(sums[group].opening),
    purchase: litresOf(sums[group].purchase),
    total: litresOf(sums[group].total),
    sales: litresOf(sums[group].sales),
    closing: litresOf(sums[group].closing),
  });
  const beer = line('BEER');
  const iml = line('IML');
  const add = (a: number, b: number) => Math.round((a + b) * 100) / 100;
  return [
    beer,
    iml,
    {
      group: 'Grand Total',
      opening: add(beer.opening, iml.opening),
      purchase: add(beer.purchase, iml.purchase),
      total: add(beer.total, iml.total),
      sales: add(beer.sales, iml.sales),
      closing: add(beer.closing, iml.closing),
    },
  ];
}

export interface RemittanceRow {
  productId: string;
  openingQty: number;
  openingValue: Paise;
  purchaseQty: number;
  purchaseValue: Paise;
  transferInQty: number;
  transferInValue: Paise;
  transferOutQty: number;
  transferOutValue: Paise;
  salesQty: number;
  salesValue: Paise;
  adjustQty: number;
  adjustValue: Paise;
  closingQty: number;
  closingValue: Paise;
}

/** Every flow in bottles and at MRP, over a range of IST days. `adjust` (count corrections and losses) keeps the columns adding up. */
export function remittance(
  movements: StockMovement[],
  products: ProductSource,
  mrpOf: (productId: string) => Paise,
  storeCode: string,
  fromDay: string,
  toDay: string,
): RemittanceRow[] {
  const known = productMap(products);
  const rows: RemittanceRow[] = [];
  for (const [productId, f] of stockFlows(movements, storeCode, fromDay, toDay)) {
    if (!known.has(productId)) continue;
    const mrp = mrpOf(productId);
    rows.push({
      productId,
      openingQty: f.opening,
      openingValue: f.opening * mrp,
      purchaseQty: f.purchase,
      purchaseValue: f.purchase * mrp,
      transferInQty: f.transferIn,
      transferInValue: f.transferIn * mrp,
      transferOutQty: f.transferOut,
      transferOutValue: f.transferOut * mrp,
      salesQty: f.sales,
      salesValue: f.sales * mrp,
      adjustQty: f.adjust,
      adjustValue: f.adjust * mrp,
      closingQty: f.closing,
      closingValue: f.closing * mrp,
    });
  }
  return rows;
}

export interface ValuationRow {
  productId: string;
  opening: number;
  openingValue: Paise;
  /** Bottles returned to the supplier. */
  returns: number;
  returnsValue: Paise;
  sales: number;
  salesCost: Paise;
  closing: number;
  closingValue: Paise;
  /** Closing stock at MRP. */
  mrpAmount: Paise;
}

/**
 * Stock valuation (landed cost) for one IST day. Every figure uses the current purchase price + AROED, because the
 * demo keeps no per-lot costs.
 */
export function valuation(
  movements: StockMovement[],
  products: ProductSource,
  costOf: (productId: string) => Paise,
  mrpOf: (productId: string) => Paise,
  storeCode: string,
  istDay: string,
): ValuationRow[] {
  const known = productMap(products);
  const rows: ValuationRow[] = [];
  for (const [productId, f] of stockFlows(movements, storeCode, istDay, istDay)) {
    if (!known.has(productId)) continue;
    const cost = costOf(productId);
    rows.push({
      productId,
      opening: f.opening,
      openingValue: f.opening * cost,
      returns: f.returns,
      returnsValue: f.returns * cost,
      sales: f.sales,
      salesCost: f.sales * cost,
      closing: f.closing,
      closingValue: f.closing * cost,
      mrpAmount: f.closing * mrpOf(productId),
    });
  }
  return rows;
}

export interface LossRow {
  storeCode: string;
  reason: Loss['reason'];
  qty: number;
  litres: number;
}

/** Losses of one IST month (`2026-08`) added up by shop and reason. */
export function lossesReport(losses: Loss[], products: ProductSource, monthIst: string): LossRow[] {
  const known = productMap(products);
  const groups = new Map<string, { storeCode: string; reason: Loss['reason']; qty: number; ml: number }>();
  for (const l of losses) {
    if (!istDate(l.at).startsWith(monthIst)) continue;
    const key = `${l.storeCode}|${l.reason}`;
    const g = groups.get(key) ?? { storeCode: l.storeCode, reason: l.reason, qty: 0, ml: 0 };
    const qty = Math.abs(l.qty);
    g.qty += qty;
    const p = known.get(l.productId);
    if (p) g.ml += mlOf(qty, p);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => (a.storeCode === b.storeCode ? a.reason.localeCompare(b.reason) : a.storeCode.localeCompare(b.storeCode)))
    .map((g) => ({ storeCode: g.storeCode, reason: g.reason, qty: g.qty, litres: litresOf(g.ml) }));
}

export interface DiscountRow {
  brand: string;
  /** `store` or `brand`, as set on the offer. */
  offerType: Offer['type'] | '';
  product: string;
  offerCode: string;
  billNumber: string;
  qty: number;
  /** Bottles given free by a buy-N-get-M offer; 0 for a rupees-off offer. */
  freeQty: number;
  amount: Paise;
  discount: Paise;
}

/** Bill lines that carried an offer, on paid bills between two IST days (both included). */
export function discountsReport(
  lines: BillLine[],
  bills: Bill[],
  offers: Offer[],
  products: ProductSource,
  fromDay: string,
  toDay: string,
): DiscountRow[] {
  const known = productMap(products);
  const paid = new Set<string>();
  for (const b of bills) {
    const day = istDate(b.at);
    if (b.status === 'paid' && day >= fromDay && day <= toDay) paid.add(b.number);
  }
  const offerByCode = new Map(offers.map((o) => [o.code, o]));
  const rows: DiscountRow[] = [];
  for (const l of lines) {
    if (!l.offerCode || !paid.has(l.billNumber)) continue;
    const offer = offerByCode.get(l.offerCode);
    const p = known.get(l.productId);
    rows.push({
      brand: p?.brand ?? '',
      offerType: offer?.type ?? '',
      product: p?.description ?? l.productId,
      offerCode: l.offerCode,
      billNumber: l.billNumber,
      qty: l.qty,
      freeQty: offer?.discountType === 'free_qty' && l.mrp > 0 ? Math.round(l.discount / l.mrp) : 0,
      amount: l.amount,
      discount: l.discount,
    });
  }
  return rows;
}
