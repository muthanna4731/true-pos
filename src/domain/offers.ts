import type { Offer, Paise, Product } from './types';

/**
 * The offer running for a product on an IST day (`YYYY-MM-DD`, first and last day included).
 * A store offer names the product, a brand offer the brand.
 * If several offers apply, the first one in list order wins; they never stack.
 */
export function applicableOffer(p: Product, offers: Offer[], istDay: string): Offer | undefined {
  return offers.find(
    (o) =>
      o.from <= istDay &&
      istDay <= o.to &&
      (o.type === 'store' ? o.productId === p.id : o.brand !== undefined && o.brand === p.brand),
  );
}

/**
 * What an offer takes off a whole line of `qty` units at `mrp` each.
 * 'amount' takes `amountPerUnit` off each unit (never more than the MRP);
 * 'free_qty' (buy N get M) makes M units of every full group of N+M free.
 */
export function offerDiscount(o: Offer, qty: number, mrp: Paise): Paise {
  if (qty <= 0) return 0;
  if (o.discountType === 'amount') {
    return Math.min(Math.max(o.amountPerUnit ?? 0, 0), mrp) * qty;
  }
  const buy = o.buyQty ?? 0;
  const free = o.freeQty ?? 0;
  if (buy <= 0 || free <= 0) return 0;
  return Math.floor(qty / (buy + free)) * free * mrp;
}
