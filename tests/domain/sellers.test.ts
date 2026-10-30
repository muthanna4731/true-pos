import { describe, expect, it } from 'vitest';
import { brandTiles, topSellers } from '../../src/domain/sellers';
import type { Product } from '../../src/domain/types';

const NOW = '2026-10-29T10:00:00.000Z';
const line = (productId: string, qty: number, at: string, storeCode = 'TSTS1') => ({ productId, qty, at, storeCode });

describe('topSellers', () => {
  it('ignores old lines and other stores, orders by qty', () => {
    const lines = [
      line('A', 5, '2026-10-28T10:00:00Z'),
      line('B', 9, '2026-10-20T10:00:00Z'),
      line('A', 2, '2026-10-01T10:00:00Z'), // 28 days old
      line('C', 99, '2026-10-28T10:00:00Z', 'TSTS2'),
      line('B', 1, '2026-10-29T08:00:00Z'),
      line('D', 3, '2026-10-15T10:00:00Z'),
    ];
    expect(topSellers(lines, 'TSTS1', NOW)).toEqual(['B', 'A', 'D']);
  });

  it('keeps a line exactly 14 days old and drops one just older', () => {
    const lines = [line('A', 1, '2026-10-15T10:00:00.000Z'), line('B', 1, '2026-10-15T09:59:59.999Z')];
    expect(topSellers(lines, 'TSTS1', NOW)).toEqual(['A']);
  });

  it('returns at most 12 ids by default, and honours n and days', () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(`P${i}`, i + 1, '2026-10-28T10:00:00Z'));
    const top = topSellers(lines, 'TSTS1', NOW);
    expect(top).toHaveLength(12);
    expect(top[0]).toBe('P19');
    expect(topSellers(lines, 'TSTS1', NOW, 3)).toEqual(['P19', 'P18', 'P17']);
    expect(topSellers([line('A', 1, '2026-10-25T10:00:00Z')], 'TSTS1', NOW, 12, 2)).toEqual([]);
  });
});

const prod = (id: string, brand: string, sizeMl: number | null, subcategory = 'WHISKY'): Product => ({
  id,
  materialType: 'ALC',
  category: 'IML',
  subcategory,
  description: `${brand} ${sizeMl}`,
  brand,
  shortName: `${brand} ${sizeMl}`,
  sizeMl,
  pack: 'BTL',
  caseSize: 12,
  hsn: '2208',
  taxRateBp: 0,
  barcode: id,
});

describe('brandTiles', () => {
  it('groups sizes of one brand into one tile, smallest first', () => {
    const tiles = brandTiles([prod('A', 'MC', 1000), prod('B', 'MC', 750), prod('C', 'RC', 180)], new Map());
    expect(tiles).toHaveLength(2);
    const mc = tiles.find((t) => t.brand === 'MC')!;
    expect(mc.subcategory).toBe('WHISKY');
    expect(mc.sizes.map((p) => p.sizeMl)).toEqual([750, 1000]);
  });

  it('keeps one brand in two subcategories apart and puts sizeless last', () => {
    const tiles = brandTiles(
      [prod('A', 'X', null), prod('B', 'X', 90), prod('C', 'X', 750, 'RUM')],
      new Map(),
    );
    expect(tiles).toHaveLength(2);
    expect(tiles.find((t) => t.subcategory === 'WHISKY')!.sizes.map((p) => p.id)).toEqual(['B', 'A']);
  });

  it('orders tiles by the combined rank of their sizes', () => {
    const tiles = brandTiles(
      [prod('A', 'AAA', 750), prod('B', 'ZZZ', 750), prod('C', 'ZZZ', 180)],
      new Map([
        ['B', 4],
        ['C', 3],
        ['A', 5],
      ]),
    );
    expect(tiles.map((t) => t.brand)).toEqual(['ZZZ', 'AAA']);
  });
});
