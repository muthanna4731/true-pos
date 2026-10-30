import { istDate } from './time';
import type { Paise, Product, StockMovement } from './types';

function forProduct(movements: StockMovement[], storeCode: string, productId: string): StockMovement[] {
  return movements.filter((m) => m.storeCode === storeCode && m.productId === productId);
}

/** Stock on hand: the sum of the signed movements for one product in one store. */
export function onHand(movements: StockMovement[], storeCode: string, productId: string): number {
  return forProduct(movements, storeCode, productId).reduce((sum, m) => sum + m.qty, 0);
}

/** One product's movements in one store, newest first (ties: later row first). */
export function productHistory(movements: StockMovement[], storeCode: string, productId: string): StockMovement[] {
  return forProduct(movements, storeCode, productId).sort((a, b) =>
    a.at === b.at ? (b.id ?? 0) - (a.id ?? 0) : a.at < b.at ? 1 : -1,
  );
}

/** How a counted quantity compares with what was expected: all there, fewer, or more. */
export function lineStatus(expected: number, counted: number): 'match' | 'short' | 'extra' {
  return counted === expected ? 'match' : counted < expected ? 'short' : 'extra';
}

/** Products as a list or as the id-keyed map some screens already hold. */
export type ProductSource = Product[] | Map<string, Product>;

export function productMap(products: ProductSource): Map<string, Product> {
  return products instanceof Map ? products : new Map(products.map((p) => [p.id, p]));
}

/** One product's stock figures for a range of IST days, all in bottles. */
export interface StockFlow {
  /** Stock at the start of the range (opening-stock rows dated inside the range count here too). */
  opening: number;
  /** Purchases less purchase returns. */
  purchase: number;
  /** Bottles sent back to the supplier (positive). Already inside `purchase`. */
  returns: number;
  transferIn: number;
  /** Bottles sent out to other shops (positive). */
  transferOut: number;
  /** Sales less voids. */
  sales: number;
  /** Count corrections and losses (signed). */
  adjust: number;
  /** Sum of the positive movements in the range, opening rows apart. */
  received: number;
  /** Absolute sum of the negative movements in the range, opening rows apart. */
  issued: number;
  /** Stock on hand at the end of `toDay`. */
  closing: number;
}

/**
 * The one place that turns the ledger into columns. `opening + purchase + transferIn - transferOut - sales + adjust === closing`.
 * Days are IST. Only products with a movement up to `toDay` appear; the result is sorted by product id.
 */
export function stockFlows(movements: StockMovement[], storeCode: string, fromDay: string, toDay: string): Map<string, StockFlow> {
  const flows = new Map<string, StockFlow>();
  for (const m of movements) {
    if (m.storeCode !== storeCode) continue;
    const day = istDate(m.at);
    if (day > toDay) continue;
    let f = flows.get(m.productId);
    if (!f) {
      f = { opening: 0, purchase: 0, returns: 0, transferIn: 0, transferOut: 0, sales: 0, adjust: 0, received: 0, issued: 0, closing: 0 };
      flows.set(m.productId, f);
    }
    f.closing += m.qty;
    if (day < fromDay || m.kind === 'opening') {
      f.opening += m.qty;
      continue;
    }
    if (m.qty > 0) f.received += m.qty;
    else f.issued -= m.qty;
    switch (m.kind) {
      case 'purchase':
        f.purchase += m.qty;
        break;
      case 'purchase_return':
        f.purchase += m.qty;
        f.returns -= m.qty;
        break;
      case 'transfer_in':
        f.transferIn += m.qty;
        break;
      case 'transfer_out':
        f.transferOut -= m.qty;
        break;
      case 'sale':
      case 'void':
        f.sales -= m.qty;
        break;
      case 'count_adjust':
      case 'loss':
        f.adjust += m.qty;
        break;
    }
  }
  return new Map([...flows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface DailySheetRow {
  productId: string;
  opening: number;
  /** Purchases less purchase returns. */
  purchase: number;
  transferIn: number;
  transferOut: number;
  total: number;
  /** Sales less voids. */
  sales: number;
  /** Count corrections plus losses (signed). */
  adjust: number;
  closing: number;
  mrp: Paise;
  salesValue: Paise;
}

/** The Daily Sheet of one shop on one IST day: a row per product that has any history up to that day. */
export function dailySheet(
  movements: StockMovement[],
  products: ProductSource,
  mrpOf: (productId: string) => Paise,
  storeCode: string,
  istDay: string,
): DailySheetRow[] {
  const known = productMap(products);
  const rows: DailySheetRow[] = [];
  for (const [productId, f] of stockFlows(movements, storeCode, istDay, istDay)) {
    if (!known.has(productId)) continue;
    const mrp = mrpOf(productId);
    rows.push({
      productId,
      opening: f.opening,
      purchase: f.purchase,
      transferIn: f.transferIn,
      transferOut: f.transferOut,
      total: f.opening + f.purchase + f.transferIn - f.transferOut,
      sales: f.sales,
      adjust: f.adjust,
      closing: f.closing,
      mrp,
      salesValue: f.sales * mrp,
    });
  }
  return rows;
}
