import type { Paise, Price } from './types';

/**
 * The MRP in force per product on an IST day (`YYYY-MM-DD`): the latest price whose `effectiveFrom` day has
 * started (that day included). Products with no started price are left out.
 */
export function priceInForce(prices: Price[], istDay: string): Map<string, Paise> {
  const best = new Map<string, { from: string; mrp: Paise }>();
  for (const p of prices) {
    if (p.effectiveFrom > istDay) continue;
    const have = best.get(p.productId);
    if (!have || p.effectiveFrom > have.from) best.set(p.productId, { from: p.effectiveFrom, mrp: p.mrp });
  }
  return new Map([...best].map(([id, v]) => [id, v.mrp]));
}

/** The whole price row in force per product on an IST day (same rule as `priceInForce`). */
export function priceRowsInForce(prices: Price[], istDay: string): Map<string, Price> {
  const best = new Map<string, Price>();
  for (const p of prices) {
    if (p.effectiveFrom > istDay) continue;
    const have = best.get(p.productId);
    if (!have || p.effectiveFrom >= have.effectiveFrom) best.set(p.productId, p);
  }
  return best;
}
