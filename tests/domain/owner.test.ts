import { beforeAll, describe, expect, it } from 'vitest';
import { chainMonthToDate, nightlySummaryText, shopSummaries, type ShopSummary } from '../../src/domain/owner';
import { generateTodos } from '../../src/domain/todos';
import { generateSeed, type SeedData } from '../../src/seed/generate';
import { DEMO_SEED } from '../../src/seed/load';

const NOW = '2026-10-29T06:30:00.000Z';
let seed: SeedData;
let rows: ShopSummary[];

const summaries = (istDay: string) =>
  shopSummaries({
    stores: seed.stores,
    bills: seed.bills,
    payments: seed.payments,
    shifts: seed.shifts,
    dayCloses: seed.dayCloses,
    movements: seed.movements,
    todos: generateTodos({ stores: seed.stores, products: seed.products, movements: seed.movements, grns: seed.grns, transfers: seed.transfers, counts: seed.counts, dayCloses: seed.dayCloses, bills: seed.bills, claims: seed.claims, nowIso: NOW }),
    istDay,
    nowIso: NOW,
  });

beforeAll(() => {
  seed = generateSeed({ seed: DEMO_SEED, today: '2026-10-29', days: 3 });
  rows = summaries('2026-10-28');
});

describe('nightlySummaryText', () => {
  it('matches the template exactly', () => {
    const two = [
      { name: 'True Spirits 1', net: 6299000, byMode: { cash: 0, upi: 6299000, card: 0 }, cashShort: 0, closed: true },
      { name: 'True Spirits 4', net: 2010000, byMode: { cash: 500000, upi: 1510000, card: 0 }, cashShort: 20000, closed: false },
    ];
    expect(nightlySummaryText('2026-08-12', two)).toBe(
      [
        'True Spirits · 12 Aug 2026',
        'True Spirits 1: ₹62,990 (Cash ₹0, UPI ₹62,990, Card ₹0) · cash short ₹0 · closed ✓',
        'True Spirits 4: ₹20,100 (Cash ₹5,000, UPI ₹15,100, Card ₹0) · cash short ₹200 · not closed',
        'Chain: ₹83,090',
      ].join('\n'),
    );
  });
});

describe('shopSummaries', () => {
  it('has one row per shop and TS4 did not lock yesterday', () => {
    expect(rows).toHaveLength(seed.stores.length);
    expect(rows.find((r) => r.storeCode === 'TSTS4')?.closed).toBe(false);
    expect(rows.find((r) => r.storeCode === 'TSTS1')?.closed).toBe(true);
  });

  it('counts paid bills only and splits the net by mode', () => {
    const r = rows.find((x) => x.storeCode === 'TSTS1')!;
    const mine = seed.bills.filter((b) => b.storeCode === 'TSTS1' && b.status === 'paid' && b.at >= '2026-10-27T18:30:00.000Z' && b.at < '2026-10-28T18:30:00.000Z');
    expect(r.bills).toBe(mine.length);
    expect(r.net).toBe(mine.reduce((s, b) => s + b.net, 0));
    expect(r.byMode.cash + r.byMode.upi + r.byMode.card).toBe(r.net);
    expect(r.net).toBeGreaterThan(0);
  });

  it('cash short is never negative and low stock counts are whole numbers', () => {
    for (const r of rows) {
      expect(r.cashShort).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.lowStock)).toBe(true);
    }
  });
});

describe('chainMonthToDate', () => {
  it('adds every shop from the 1st to the day, paid bills only', () => {
    const want = seed.bills
      .filter((b) => b.status === 'paid' && b.at >= '2026-09-30T18:30:00.000Z' && b.at < '2026-10-28T18:30:00.000Z')
      .reduce((s, b) => s + b.net, 0);
    expect(chainMonthToDate(seed.bills, '2026-10-28')).toBe(want);
  });
});
