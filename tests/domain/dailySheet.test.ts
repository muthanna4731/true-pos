import { describe, expect, it } from 'vitest';
import { dailySheet } from '../../src/domain/stock';
import { onHand } from '../../src/domain/stock';
import { istDate } from '../../src/domain/time';
import type { MovementKind, Product, StockMovement } from '../../src/domain/types';
import { generateSeed } from '../../src/seed/generate';
import { mulberry32 } from '../../src/seed/rng';

const product = (id: string): Product => ({
  id,
  materialType: 'ALC',
  category: 'IML',
  subcategory: 'WHISKY',
  description: id,
  brand: id,
  shortName: id,
  sizeMl: 90,
  pack: 'TPACK',
  caseSize: 96,
  hsn: '2208',
  taxRateBp: 0,
  barcode: id,
});

const mv = (productId: string, qty: number, kind: MovementKind, at: string, storeCode = 'TSTS1'): StockMovement => ({
  storeCode,
  productId,
  qty,
  kind,
  ref: kind,
  at,
});

const mrpOf = () => 12000;

describe('dailySheet', () => {
  const products = [product('P1')];
  const movements = [
    mv('P1', 100, 'opening', '2026-08-10T02:30:00Z'), // 10 Aug 8:00 AM IST
    mv('P1', 24, 'purchase', '2026-08-11T05:00:00Z'),
    mv('P1', -4, 'purchase_return', '2026-08-11T06:00:00Z'),
    mv('P1', 10, 'transfer_in', '2026-08-11T06:30:00Z'),
    mv('P1', -6, 'transfer_out', '2026-08-11T07:00:00Z'),
    mv('P1', -30, 'sale', '2026-08-11T08:00:00Z'),
    mv('P1', 2, 'void', '2026-08-11T08:30:00Z'),
    mv('P1', -1, 'count_adjust', '2026-08-11T09:00:00Z'),
    mv('P1', -2, 'loss', '2026-08-11T09:30:00Z'),
    mv('P1', 50, 'purchase', '2026-08-11T20:00:00Z'), // 12 Aug 1:30 AM IST: the next day
    mv('P1', 99, 'purchase', '2026-08-11T05:00:00Z', 'TSTS2'), // another shop
  ];

  it('lays the day out column by column from the ledger', () => {
    const [row] = dailySheet(movements, products, mrpOf, 'TSTS1', '2026-08-11');
    expect(row).toEqual({
      productId: 'P1',
      opening: 100,
      purchase: 20,
      transferIn: 10,
      transferOut: 6,
      total: 124,
      sales: 28,
      adjust: -3,
      closing: 93,
      mrp: 12000,
      salesValue: 28 * 12000,
    });
  });

  it('counts opening-stock rows on their own day as the opening column', () => {
    const [row] = dailySheet(movements, products, mrpOf, 'TSTS1', '2026-08-10');
    expect(row).toMatchObject({ opening: 100, purchase: 0, total: 100, sales: 0, closing: 100 });
  });

  it('shows the day in IST, so a 1:30 AM IST purchase belongs to the next day', () => {
    const [row] = dailySheet(movements, products, mrpOf, 'TSTS1', '2026-08-12');
    expect(row).toMatchObject({ opening: 93, purchase: 50, closing: 143 });
  });

  it('leaves out products with no history yet, and accepts a product map', () => {
    expect(dailySheet(movements, products, mrpOf, 'TSTS1', '2026-08-09')).toEqual([]);
    expect(dailySheet(movements, new Map(products.map((p) => [p.id, p])), mrpOf, 'TSTS1', '2026-08-11')).toHaveLength(1);
  });

  it('closes on the stock on hand at the end of every sampled day of the seeded history (TS1)', () => {
    const today = '2026-10-29';
    const seed = generateSeed({ seed: 20261029, today, days: 6 });
    const ts1 = seed.movements.filter((m) => m.storeCode === 'TSTS1');
    const rng = mulberry32(7);
    const days = new Set<string>();
    const all = [...new Set(ts1.map((m) => istDate(m.at)))].sort();
    while (days.size < 3) days.add(all[Math.floor(rng() * all.length)]!);

    for (const day of days) {
      const upTo = ts1.filter((m) => istDate(m.at) <= day);
      const rows = dailySheet(ts1, seed.products, () => 0, 'TSTS1', day);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.closing).toBe(onHand(upTo, 'TSTS1', r.productId));
        expect(r.total - r.sales + r.adjust).toBe(r.closing);
      }
      // A product left out has no movements yet, so nothing on hand.
      const listed = new Set(rows.map((r) => r.productId));
      for (const p of seed.products) if (!listed.has(p.id)) expect(onHand(upTo, 'TSTS1', p.id)).toBe(0);
    }
  });
});
