import { applicableOffer, offerDiscount } from './offers';
import type { BillLine, Offer, Paise, Product } from './types';

export interface Cart {
  clientId: string;
  lines: { productId: string; qty: number }[];
  memberCode?: string;
}

export type CartAction =
  | { type: 'add'; productId: string }
  | { type: 'setQty'; productId: string; qty: number }
  | { type: 'remove'; productId: string }
  | { type: 'member'; code?: string }
  /** Starts the next sale. `clientId` must be new for every sale (e.g. `crypto.randomUUID()`): `recordSale` returns the existing bill when it sees a repeated one. */
  | { type: 'clear'; clientId: string };

/** Pure cart update. `clear` empties lines and member and takes the new sale's `clientId` from the action. */
export function cartReducer(c: Cart, a: CartAction): Cart {
  switch (a.type) {
    case 'add': {
      const has = c.lines.some((l) => l.productId === a.productId);
      return {
        ...c,
        lines: has
          ? c.lines.map((l) => (l.productId === a.productId ? { ...l, qty: l.qty + 1 } : l))
          : [...c.lines, { productId: a.productId, qty: 1 }],
      };
    }
    case 'setQty': {
      if (Number.isNaN(a.qty) || !c.lines.some((l) => l.productId === a.productId)) return c;
      const qty = Math.floor(a.qty);
      return {
        ...c,
        lines:
          qty > 0
            ? c.lines.map((l) => (l.productId === a.productId ? { ...l, qty } : l))
            : c.lines.filter((l) => l.productId !== a.productId),
      };
    }
    case 'remove':
      return { ...c, lines: c.lines.filter((l) => l.productId !== a.productId) };
    case 'member': {
      const { memberCode: _drop, ...rest } = c;
      return a.code ? { ...rest, memberCode: a.code } : rest;
    }
    case 'clear':
      return { clientId: a.clientId, lines: [] };
  }
}

/** A priced line: a bill line minus the ids that only exist once the sale is recorded. */
export type PricedLine = Omit<BillLine, 'id' | 'billNumber'> & { shortName: string };

export interface PricedCart {
  lines: PricedLine[];
  gross: Paise;
  discount: Paise;
  tax: Paise;
  net: Paise;
}

/**
 * Price a cart. MRP includes tax, so per line: gross = mrp x qty, discount from the first applicable offer,
 * amount = gross - discount, tax = the share of `amount` that is tax. `offerCode` is set only when the
 * offer actually took something off. Totals are sums of the line values; net = gross - discount.
 * Throws `unknown_product` for an id missing from `products`.
 */
export function priceCart(
  c: Cart,
  products: Map<string, Product>,
  mrpOf: (id: string) => Paise,
  offers: Offer[],
  istDay: string,
): PricedCart {
  const lines = c.lines.map((l): PricedLine => {
    const p = products.get(l.productId);
    if (!p) throw new Error('unknown_product');
    const mrp = mrpOf(p.id);
    const offer = applicableOffer(p, offers, istDay);
    const discount = offer ? offerDiscount(offer, l.qty, mrp) : 0;
    const amount = mrp * l.qty - discount;
    const rate = p.taxRateBp;
    return {
      productId: p.id,
      shortName: p.shortName,
      qty: l.qty,
      mrp,
      ...(offer && discount > 0 ? { offerCode: offer.code } : {}),
      discount,
      tax: Math.round((amount * rate) / (10000 + rate)),
      amount,
    };
  });
  const sum = (f: (l: PricedLine) => number): number => lines.reduce((s, l) => s + f(l), 0);
  const gross = sum((l) => l.mrp * l.qty);
  const discount = sum((l) => l.discount);
  return { lines, gross, discount, tax: sum((l) => l.tax), net: gross - discount };
}
