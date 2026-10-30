import type { Paise, Price } from './types';

/**
 * The whole price row in force per product on an IST day (`YYYY-MM-DD`): the latest row whose `effectiveFrom`
 * day has started (that day included). On a same-day tie the later row (pushed last, higher id) wins, as in `priceAt`.
 */
export function priceRowsInForce(prices: Price[], istDay: string): Map<string, Price> {
  const best = new Map<string, Price>();
  for (const p of prices) {
    if (p.effectiveFrom > istDay) continue;
    const have = best.get(p.productId);
    if (!have || p.effectiveFrom >= have.effectiveFrom) best.set(p.productId, p);
  }
  return best;
}

/** The MRP in force per product on an IST day, by the same rule as `priceRowsInForce`. */
export function priceInForce(prices: Price[], istDay: string): Map<string, Paise> {
  return new Map([...priceRowsInForce(prices, istDay)].map(([id, p]) => [id, p.mrp]));
}
