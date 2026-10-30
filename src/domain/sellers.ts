import type { Product } from './types';

const DAY_MS = 86400000;

/**
 * Product ids sold most at one store in the last `days` days, best first (ties by id so the order is stable).
 * Feeds the quick-pick tiles on the bill screen.
 */
export function topSellers(
  lines: { productId: string; qty: number; at: string; storeCode: string }[],
  storeCode: string,
  nowIso: string,
  n = 12,
  days = 14,
): string[] {
  const since = new Date(nowIso).getTime() - days * DAY_MS;
  const qty = new Map<string, number>();
  for (const l of lines) {
    if (l.storeCode !== storeCode || new Date(l.at).getTime() < since) continue;
    qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty);
  }
  return [...qty.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([id]) => id);
}

export interface BrandTile {
  brand: string;
  subcategory: string;
  sizes: Product[];
}

/**
 * One tile per brand (and subcategory), its sizes smallest first with sizeless products last.
 * Tiles are ordered by the sales rank of all their sizes together, then by brand name.
 */
export function brandTiles(products: Product[], rank: Map<string, number>): BrandTile[] {
  const tiles = new Map<string, BrandTile>();
  for (const p of products) {
    const key = `${p.subcategory}\u0000${p.brand}`;
    const tile = tiles.get(key);
    if (tile) tile.sizes.push(p);
    else tiles.set(key, { brand: p.brand, subcategory: p.subcategory, sizes: [p] });
  }
  const size = (p: Product): number => p.sizeMl ?? Number.POSITIVE_INFINITY;
  const total = (t: BrandTile): number => t.sizes.reduce((s, p) => s + (rank.get(p.id) ?? 0), 0);
  for (const t of tiles.values()) {
    t.sizes.sort((a, b) => (size(a) === size(b) ? (a.description < b.description ? -1 : 1) : size(a) - size(b)));
  }
  return [...tiles.values()].sort((a, b) => total(b) - total(a) || (a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : 0));
}
