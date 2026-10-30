import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { dispatchTransfer, receiveTransfer, recordLoss } from '../../src/db/stockOps';
import { avgDailySales, refillSuggestion } from '../../src/domain/orders';
import { onHand } from '../../src/domain/stock';
import { generateTodos } from '../../src/domain/todos';
import type { StockMovement } from '../../src/domain/types';
import { generateSeed } from '../../src/seed/generate';
import { DEMO_SEED, loadSeedIfEmpty } from '../../src/seed/load';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const A = 'P0001';

const stock = async (store: string, id = A) => onHand(await db.movements.toArray(), store, id);
const seedStock = async (store: string, qty: number) => {
  await db.movements.add({ storeCode: store, productId: A, qty, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' });
};
const transfer = (over: Partial<Parameters<typeof dispatchTransfer>[0]> = {}) => ({
  id: 'TR-1',
  fromStore: 'TSTS1',
  toStore: 'TSTS2',
  permitNo: 'KA-EX-123456',
  lines: [{ productId: A, qty: 48 }],
  ...over,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
});
afterEach(() => vi.useRealTimers());

describe('dispatchTransfer / receiveTransfer', () => {
  it('refuses a blank permit number and writes nothing', async () => {
    await seedStock('TSTS1', 100);
    await expect(dispatchTransfer(transfer({ permitNo: '   ' }), 'U')).rejects.toThrow('permit_required');
    expect(await db.transfers.count()).toBe(0);
    expect(await stock('TSTS1')).toBe(100);
  });

  it('moves 48 out of the sender at once; the receiver is unchanged until it is received', async () => {
    await seedStock('TSTS1', 100);
    await dispatchTransfer(transfer(), 'U');
    expect(await stock('TSTS1')).toBe(52);
    expect(await stock('TSTS2')).toBe(0);
    expect(await db.transfers.get('TR-1')).toMatchObject({ status: 'in_transit', permitNo: 'KA-EX-123456', dispatchedAt: NOON_IST });

    await receiveTransfer('TR-1', 'U');
    expect(await stock('TSTS2')).toBe(48);
    expect(await stock('TSTS1')).toBe(52);
    expect(await db.transfers.get('TR-1')).toMatchObject({ status: 'received', receivedAt: NOON_IST });
  });

  it('is safe to call twice: no second dispatch, no second receipt', async () => {
    await seedStock('TSTS1', 100);
    await dispatchTransfer(transfer(), 'U');
    await expect(dispatchTransfer(transfer(), 'U')).rejects.toThrow('transfer_exists');
    await receiveTransfer('TR-1', 'U');
    await expect(receiveTransfer('TR-1', 'U')).rejects.toThrow('cannot_receive');
    expect(await stock('TSTS1')).toBe(52);
    expect(await stock('TSTS2')).toBe(48);
  });

  it('refuses bad quantities and the same shop on both ends', async () => {
    await expect(dispatchTransfer(transfer({ lines: [] }), 'U')).rejects.toThrow('bad_qty');
    await expect(dispatchTransfer(transfer({ lines: [{ productId: A, qty: 1.5 }] }), 'U')).rejects.toThrow('bad_qty');
    await expect(dispatchTransfer(transfer({ toStore: 'TSTS1' }), 'U')).rejects.toThrow('same_store');
  });
});

describe('recordLoss', () => {
  it('writes a losses row and a loss movement of -qty with the same ref', async () => {
    await seedStock('TSTS1', 10);
    await recordLoss('TSTS1', A, 3, 'leakage', 'U-MGR', ' dropped ');
    const loss = (await db.losses.toArray())[0];
    expect(loss).toMatchObject({ storeCode: 'TSTS1', productId: A, qty: 3, reason: 'leakage', by: 'U-MGR', note: 'dropped' });
    const move = (await db.movements.where('kind').equals('loss').toArray())[0];
    expect(move).toMatchObject({ qty: -3, ref: loss.ref });
    expect(await stock('TSTS1')).toBe(7);
    await expect(recordLoss('TSTS1', A, 0, 'theft', 'U')).rejects.toThrow('bad_qty');
  });
});

describe('refillSuggestion', () => {
  const mv = (storeCode: string, qty: number, kind: StockMovement['kind'] = 'opening', at = '2026-10-01T00:00:00.000Z'): StockMovement => ({ storeCode, productId: A, qty, kind, ref: 'r', at });

  it('fills a low shop up to twice its level, but never more than the hub has', () => {
    // 4 a day -> level 12; shop has 2 -> wants 22.
    const sales = new Map([['TSTS2|P0001', 4]]);
    expect(refillSuggestion('TSTS2', 'TSTS1', [mv('TSTS2', 2), mv('TSTS1', 500)], sales)).toEqual([{ productId: A, qty: 22 }]);
    expect(refillSuggestion('TSTS2', 'TSTS1', [mv('TSTS2', 2), mv('TSTS1', 5)], sales)).toEqual([{ productId: A, qty: 5 }]);
    expect(refillSuggestion('TSTS2', 'TSTS1', [mv('TSTS2', 2)], sales)).toEqual([]);
  });

  it('leaves out a shop that is not low and products that do not sell', () => {
    const sales = new Map([['TSTS2|P0001', 4], ['TSTS3|P0001', 4]]);
    expect(refillSuggestion('TSTS2', 'TSTS1', [mv('TSTS2', 12), mv('TSTS1', 500)], sales)).toEqual([]);
    expect(refillSuggestion('TSTS2', 'TSTS1', [mv('TSTS2', 0), mv('TSTS1', 500)], new Map([['TSTS2|P0001', 0]]))).toEqual([]);
  });

  it('on the seed never exceeds the hub stock', () => {
    const seed = generateSeed({ seed: DEMO_SEED, today: '2026-10-29', days: 3 });
    const sales = avgDailySales(seed.movements, NOON_IST);
    const hub = new Map<string, number>();
    for (const m of seed.movements) if (m.storeCode === 'TSTS1') hub.set(m.productId, (hub.get(m.productId) ?? 0) + m.qty);
    const out = refillSuggestion('TSTS5', 'TSTS1', seed.movements, sales);
    for (const l of out) expect(l.qty).toBeLessThanOrEqual(hub.get(l.productId) ?? 0);
  });
});

describe('the seeded stuck transfer', () => {
  it('stops being a to-do once it is received', async () => {
    await loadSeedIfEmpty(db, { days: 3 });
    const input = async () => {
      const [stores, products, movements, grns, transfers, counts, dayCloses, bills, claims] = await Promise.all([
        db.stores.toArray(), db.products.toArray(), db.movements.toArray(), db.grns.toArray(), db.transfers.toArray(),
        db.counts.toArray(), db.dayCloses.toArray(), db.bills.toArray(), db.claims.toArray(),
      ]);
      return { stores, products, movements, grns, transfers, counts, dayCloses, bills, claims, nowIso: NOON_IST };
    };
    const stuck = async () => generateTodos(await input()).filter((x) => x.kind === 'transfer_stuck' && x.ref === 'TR-PLANT-1');
    expect(await stuck()).toHaveLength(1);
    await receiveTransfer('TR-PLANT-1', 'U-OFFICE');
    expect(await stuck()).toHaveLength(0);
  }, 120000);
});
