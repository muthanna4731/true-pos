import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { DayClosedError, recordSale, voidBill } from '../../src/db/sales';
import { closeShift, expectedCash, openShift } from '../../src/db/shifts';
import { buildProduct } from '../../src/domain/catalogue';
import type { PayMode } from '../../src/domain/types';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const product = buildProduct({ subcategory: 'WHISKY', description: 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', mrpRupees: 0 }, 1);

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await db.products.add(product);
  await db.users.bulkAdd([
    { id: 'U1', name: 'Cashier 1', phone: '1', role: 'cashier', pinHash: 'x', storeCodes: ['TSTS1'] },
    { id: 'U2', name: 'Cashier 2', phone: '2', role: 'cashier', pinHash: 'x', storeCodes: ['TSTS1'] },
    { id: 'M1', name: 'Manager 1', phone: '3', role: 'manager', pinHash: 'x', storeCodes: ['TSTS1'] },
    { id: 'M2', name: 'Manager 2', phone: '4', role: 'manager', pinHash: 'x', storeCodes: ['TSTS2'] },
  ]);
  await db.movements.add({ storeCode: 'TSTS1', productId: product.id, qty: 500, kind: 'opening', ref: 'open', at: '2026-10-01T00:00:00.000Z' });
});
afterEach(() => {
  vi.useRealTimers();
});

let n = 0;
async function sell(shiftId: string, amount: number, mode: PayMode = 'cash', practice = false) {
  n += 1;
  return recordSale({
    clientId: `c${n}`,
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId,
    lines: [{ productId: product.id, qty: 1, mrp: amount, discount: 0, tax: 0 }],
    payments: [{ mode, amount }],
    practice,
  });
}

describe('expectedCash', () => {
  it('is the float plus the cash of paid bills in that shift only', async () => {
    const shift = await openShift('TSTS1', 'U1', 200000);
    const other = await openShift('TSTS1', 'U2', 200000);
    await sell(shift, 30000, 'cash');
    await sell(shift, 20000, 'upi');
    await sell(shift, 10000, 'card');
    await sell(shift, 70000, 'cash', true); // practice
    const voided = await sell(shift, 50000, 'cash');
    await voidBill(voided.number, 'M1');
    await sell(other, 99900, 'cash');
    expect(await expectedCash(shift)).toBe(230000);
    expect(await expectedCash(other)).toBe(299900);
  });
});

describe('closeShift', () => {
  it('works out the difference: expected ₹1,000, counted ₹900 is ₹100 short', async () => {
    const shift = await openShift('TSTS1', 'U1', 50000);
    await sell(shift, 50000, 'cash');
    await openShift('TSTS1', 'U2'); // someone else is still working
    const result = await closeShift(shift, { 500: 1, 200: 2 }, 0);
    expect(result).toEqual({ expected: 100000, counted: 90000, diff: -10000, dayLocked: false });
    expect(await db.shifts.get(shift)).toMatchObject({ closedAt: NOON_IST, expected: 100000, counted: 90000, diff: -10000 });
  });

  it('adds the coins to the counted cash', async () => {
    const shift = await openShift('TSTS1', 'U1', 10000);
    const result = await closeShift(shift, { 50: 2 }, 1250);
    expect(result).toMatchObject({ expected: 10000, counted: 11250, diff: 1250 });
  });

  it('locks the day when the manager closes last: no more sales, totals saved', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const m = await openShift('TSTS1', 'M1', 0);
    await sell(a, 10000, 'cash');
    await sell(a, 20000, 'upi');
    await sell(a, 5000, 'cash', true);

    expect((await closeShift(a, { 100: 1 }, 0)).dayLocked).toBe(false); // the cashier goes first
    expect(await db.dayCloses.count()).toBe(0);

    expect((await closeShift(m, {}, 0)).dayLocked).toBe(true);
    const row = await db.dayCloses.get(['TSTS1', '2026-10-29']);
    expect(row).toMatchObject({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST });
    expect(row?.totals).toMatchObject({ net: 30000, bills: 2, byMode: { cash: 10000, upi: 20000, card: 0 } });

    await expect(sell(a, 100)).rejects.toBeInstanceOf(DayClosedError);
  });

  it('never locks the day on a cashier close, even the last one', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    expect(await closeShift(a, {}, 0)).toMatchObject({ dayLocked: false });
    expect(await db.dayCloses.count()).toBe(0);
    await expect(sell(await openShift('TSTS1', 'U2', 0), 100)).resolves.toBeDefined();
  });

  it('does not lock when the manager closes while a cashier shift is still open', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const m = await openShift('TSTS1', 'M1', 0);
    expect((await closeShift(m, {}, 0)).dayLocked).toBe(false);
    expect(await db.dayCloses.count()).toBe(0);
    // the cashier closing afterwards does not lock either: only a manager's close does
    expect((await closeShift(a, {}, 0)).dayLocked).toBe(false);
    expect(await db.dayCloses.count()).toBe(0);
  });

  it('does not wait for a shift left open on an earlier day, and ignores other shops', async () => {
    await db.shifts.add({ id: 'OLD', storeCode: 'TSTS1', cashierId: 'U9', openedAt: '2026-10-27T04:00:00.000Z', floatPaise: 0 });
    await openShift('TSTS2', 'M2', 0);
    const shift = await openShift('TSTS1', 'M1', 0);
    expect((await closeShift(shift, {}, 0)).dayLocked).toBe(true);
    expect(await db.dayCloses.get(['TSTS2', '2026-10-29'])).toBeUndefined();
  });

  it('locks the day the shift began on when it is closed after midnight, and leaves the next day open', async () => {
    vi.setSystemTime(new Date('2026-10-29T16:30:00.000Z')); // 22:00 IST, 29 Oct
    const shift = await openShift('TSTS1', 'M1', 0);
    await sell(shift, 10000, 'cash');
    vi.setSystemTime(new Date('2026-10-29T18:50:00.000Z')); // 00:20 IST, 30 Oct
    expect((await closeShift(shift, {}, 0)).dayLocked).toBe(true);

    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toMatchObject({ date: '2026-10-29', lockedAt: '2026-10-29T18:50:00.000Z' });
    expect((await db.dayCloses.get(['TSTS1', '2026-10-29']))?.totals).toMatchObject({ net: 10000, bills: 1 });
    expect(await db.dayCloses.get(['TSTS1', '2026-10-30'])).toBeUndefined();

    // 30 Oct can still trade; 29 Oct is shut.
    const next = await openShift('TSTS1', 'U1', 0);
    await expect(sell(next, 500)).resolves.toBeDefined();
    vi.setSystemTime(new Date('2026-10-29T17:00:00.000Z'));
    await expect(sell(next, 500)).rejects.toBeInstanceOf(DayClosedError);
  });

  it('is safe to call twice: the second call returns the first result and writes nothing new', async () => {
    const shift = await openShift('TSTS1', 'M1', 0);
    const first = await closeShift(shift, { 100: 1 }, 0);
    vi.setSystemTime(new Date('2026-10-29T08:00:00.000Z'));
    const second = await closeShift(shift, { 500: 9 }, 0);
    expect(second).toEqual(first);
    expect((await db.shifts.get(shift))?.counted).toBe(10000);
  });

  it('refuses an unknown shift', async () => {
    await expect(closeShift('NOPE', {}, 0)).rejects.toThrow('shift_not_found');
  });
});
