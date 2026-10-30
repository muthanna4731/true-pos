import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { draftGrn, receiveGrn, saveCount } from '../../src/db/stockOps';
import { onHand } from '../../src/domain/stock';
import type { Grn, Indent } from '../../src/domain/types';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const A = 'P0001';
const B = 'P0002';

const stock = async (id: string, store = 'TSTS1') => onHand(await db.movements.toArray(), store, id);

const grn = (over: Partial<Grn> = {}): Grn => ({
  id: 'GRN-1',
  storeCode: 'TSTS1',
  type: 'ksbcl',
  status: 'draft',
  supplierId: 'SUP-KSBCL',
  indentId: 'INDMYH26000001',
  invoiceNo: 'SMYH26000001',
  receivedAt: NOON_IST,
  invoiceAmount: 48 * 1000 + 12 * 2000,
  tcs: 0,
  lines: [
    { productId: A, expected: 48, unitPrice: 1000 },
    { productId: B, expected: 12, unitPrice: 2000 },
  ],
  ...over,
});
const indent: Indent = { id: 'INDMYH26000001', storeCode: 'TSTS1', placedAt: '2026-10-26T09:00:00.000Z', status: 'placed', lines: [{ productId: A, cases: 4 }] };

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await db.grns.add(grn());
  await db.indents.add(indent);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('receiveGrn', () => {
  it('books what arrived, writes breakage off, records the short count and raises a claim', async () => {
    await receiveGrn(
      'GRN-1',
      [
        { productId: A, counted: 24, broken: 2 },
        { productId: B, counted: 12, broken: 0 },
      ],
      'M1',
    );

    const saved = await db.grns.get('GRN-1');
    expect(saved?.status).toBe('received');
    expect(saved?.lines).toEqual([
      { productId: A, expected: 48, counted: 24, short: 24, broken: 2, unitPrice: 1000 },
      { productId: B, expected: 12, counted: 12, short: 0, broken: 0, unitPrice: 2000 },
    ]);

    // 24 bottles came through the door, 2 of them broken: 22 are on the shelf.
    const mine = await db.movements.where('ref').anyOf('GRN-1', 'LOSS-GRN-1-P0001').toArray();
    expect(mine.map((m) => [m.productId, m.kind, m.qty])).toEqual([
      [A, 'purchase', 24],
      [B, 'purchase', 12],
      [A, 'loss', -2],
    ]);
    expect(await stock(A)).toBe(22);
    expect(await stock(B)).toBe(12);

    expect(await db.losses.toArray()).toEqual([
      expect.objectContaining({ storeCode: 'TSTS1', productId: A, qty: 2, reason: 'breakage', by: 'M1', at: NOON_IST, ref: 'LOSS-GRN-1-P0001' }),
    ]);

    // One claim for the line that came short or broken: 24 short + 2 broken at ₹10.
    const claims = await db.claims.toArray();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ grnId: 'GRN-1', storeCode: 'TSTS1', productId: A, qty: 26, amount: 26000, status: 'open' });

    expect((await db.indents.get('INDMYH26000001'))?.status).toBe('received');
  });

  it('raises no claim and no loss for a delivery that matches', async () => {
    await receiveGrn('GRN-1', [{ productId: A, counted: 48, broken: 0 }, { productId: B, counted: 12, broken: 0 }], 'M1');
    expect(await db.claims.count()).toBe(0);
    expect(await db.losses.count()).toBe(0);
    expect(await stock(A)).toBe(48);
  });

  it('raises a claim for breakage alone, and books extra bottles as counted', async () => {
    await receiveGrn('GRN-1', [{ productId: A, counted: 50, broken: 1 }, { productId: B, counted: 12, broken: 0 }], 'M1');
    const saved = await db.grns.get('GRN-1');
    expect(saved?.lines[0]).toMatchObject({ counted: 50, short: -2, broken: 1 });
    expect((await db.claims.toArray())[0]).toMatchObject({ productId: A, qty: 1, amount: 1000 });
    expect(await stock(A)).toBe(49);
  });

  it('counts a line that was not listed as nothing arrived', async () => {
    await receiveGrn('GRN-1', [{ productId: A, counted: 48, broken: 0 }], 'M1');
    expect((await db.grns.get('GRN-1'))?.lines[1]).toMatchObject({ counted: 0, short: 12 });
    expect((await db.claims.toArray())[0]).toMatchObject({ productId: B, qty: 12, amount: 24000 });
  });

  it('refuses a second go (a double tap), an unknown delivery and bad numbers, writing nothing', async () => {
    const lines = [{ productId: A, counted: 48, broken: 0 }, { productId: B, counted: 12, broken: 0 }];
    await receiveGrn('GRN-1', lines, 'M1');
    await expect(receiveGrn('GRN-1', lines, 'M1')).rejects.toThrow('grn_received');
    expect(await stock(A)).toBe(48);

    await expect(receiveGrn('NOPE', lines, 'M1')).rejects.toThrow('grn_not_found');

    await db.grns.add(grn({ id: 'GRN-2' }));
    await expect(receiveGrn('GRN-2', [{ productId: A, counted: -1, broken: 0 }], 'M1')).rejects.toThrow('bad_count');
    await expect(receiveGrn('GRN-2', [{ productId: A, counted: 5, broken: 6 }], 'M1')).rejects.toThrow('bad_count');
    expect((await db.grns.get('GRN-2'))?.status).toBe('draft');
    expect(await db.movements.where('ref').equals('GRN-2').count()).toBe(0);
  });
});

describe('draftGrn', () => {
  it('turns a placed order into a delivery to count, with the invoice number and bottle counts', async () => {
    await db.grns.clear(); // the order has no delivery yet
    await db.products.bulkAdd([
      { id: A, caseSize: 12 } as never,
      { id: B, caseSize: 6 } as never,
    ]);
    await db.prices.add({ productId: A, mrp: 5000, purchase: 3000, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'x' });
    await db.prices.add({ productId: A, mrp: 6000, purchase: 3500, aroed: 0, cess: 0, effectiveFrom: '2026-10-01', pushedBy: 'x' });
    await db.prices.add({ productId: A, mrp: 7000, purchase: 4000, aroed: 0, cess: 0, effectiveFrom: '2026-11-01', pushedBy: 'x' });
    const id = await draftGrn('INDMYH26000001', 'SMYH26123456');
    const made = await db.grns.get(id);
    expect(made).toMatchObject({
      storeCode: 'TSTS1',
      type: 'ksbcl',
      status: 'draft',
      supplierId: 'SUP-KSBCL',
      indentId: 'INDMYH26000001',
      invoiceNo: 'SMYH26123456',
      invoiceAmount: 48 * 3500,
      tcs: Math.round(48 * 3500 * 0.02),
      lines: [{ productId: A, expected: 48, unitPrice: 3500 }],
    });
    // A second tap does not make a second delivery for the same order.
    expect(await draftGrn('INDMYH26000001', 'SMYH26123456')).toBe(id);
    expect(await db.grns.filter((g) => g.indentId === 'INDMYH26000001').count()).toBe(1);
  });
});

describe('saveCount', () => {
  it('records the count and adjusts stock by the difference', async () => {
    await db.movements.bulkAdd([
      { storeCode: 'TSTS1', productId: A, qty: 10, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' },
      { storeCode: 'TSTS1', productId: B, qty: 4, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' },
      { storeCode: 'TSTS2', productId: A, qty: 99, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' },
    ]);
    const out = await saveCount(
      'TSTS1',
      [
        { productId: A, counted: 7 },
        { productId: B, counted: 6 },
      ],
      'M1',
    );
    expect(out).toEqual([
      { productId: A, expected: 10, counted: 7, diff: -3 },
      { productId: B, expected: 4, counted: 6, diff: 2 },
    ]);
    expect(await stock(A)).toBe(7);
    expect(await stock(B)).toBe(6);
    expect(await stock(A, 'TSTS2')).toBe(99);

    const adjusts = await db.movements.where('kind').equals('count_adjust').toArray();
    expect(adjusts.map((m) => [m.productId, m.qty])).toEqual([[A, -3], [B, 2]]);
    const [count] = await db.counts.toArray();
    expect(count).toMatchObject({ storeCode: 'TSTS1', at: NOON_IST, countedBy: 'M1' });
    expect(count.lines).toEqual([
      { productId: A, system: 10, counted: 7 },
      { productId: B, system: 4, counted: 6 },
    ]);
    expect(adjusts.every((m) => m.ref === count.id)).toBe(true);
  });

  it('writes no adjustment when the shelf matches', async () => {
    await db.movements.add({ storeCode: 'TSTS1', productId: A, qty: 5, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' });
    const out = await saveCount('TSTS1', [{ productId: A, counted: 5 }], 'M1');
    expect(out).toEqual([{ productId: A, expected: 5, counted: 5, diff: 0 }]);
    expect(await db.movements.where('kind').equals('count_adjust').count()).toBe(0);
    expect(await db.counts.count()).toBe(1);
  });

  it('refuses a negative or fractional count, and an empty count', async () => {
    await expect(saveCount('TSTS1', [{ productId: A, counted: -1 }], 'M1')).rejects.toThrow('bad_count');
    await expect(saveCount('TSTS1', [{ productId: A, counted: 1.5 }], 'M1')).rejects.toThrow('bad_count');
    await expect(saveCount('TSTS1', [], 'M1')).rejects.toThrow('empty_count');
    expect(await db.counts.count()).toBe(0);
  });
});
