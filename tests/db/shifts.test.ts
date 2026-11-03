import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { DayClosedError, recordSale, voidBill } from '../../src/db/sales';
import { closeShift, dayLockable, expectedCash, lockDay, openShift } from '../../src/db/shifts';
import { buildProduct } from '../../src/domain/catalogue';
import { generateTodos } from '../../src/domain/todos';
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
    { id: 'M', name: 'Manager', phone: '3', role: 'manager', pinHash: 'x', storeCodes: ['TSTS1', 'TSTS2'] },
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
    await voidBill(voided.number, 'M');
    await sell(other, 99900, 'cash');
    expect(await expectedCash(shift)).toBe(230000);
    expect(await expectedCash(other)).toBe(299900);
  });
});

describe('closeShift', () => {
  it('counts the notes and the coins, and saves the figures on the shift', async () => {
    const shift = await openShift('TSTS1', 'U1', 200000);
    const result = await closeShift(shift, { 500: 1, 200: 2 }, 0, 'M');
    expect(result).toMatchObject({ expected: 200000, counted: 90000, diff: -110000 });
    expect(await db.shifts.get(shift)).toMatchObject({ expected: 200000, counted: 90000, diff: -110000 });
  });

  it('adds the coins to the counted cash', async () => {
    const shift = await openShift('TSTS1', 'U1', 10000);
    const result = await closeShift(shift, { 50: 2 }, 1250, 'U1');
    expect(result).toMatchObject({ expected: 10000, counted: 11250, diff: 1250 });
  });

  it('locks the day when the manager closes the last open shift: no more sales, totals saved', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const b = await openShift('TSTS1', 'U2', 0);
    await sell(a, 10000, 'cash');
    await sell(a, 20000, 'upi');
    await sell(a, 5000, 'cash', true);

    expect((await closeShift(a, { 100: 1 }, 0, 'M')).dayLocked).toBe(false); // another shift is still open
    expect(await db.dayCloses.count()).toBe(0);

    expect((await closeShift(b, {}, 0, 'M')).dayLocked).toBe(true);
    const row = await db.dayCloses.get(['TSTS1', '2026-10-29']);
    expect(row).toMatchObject({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST });
    expect(row?.totals).toMatchObject({ net: 30000, bills: 2, byMode: { cash: 10000, upi: 20000, card: 0 } });

    await expect(sell(a, 100)).rejects.toBeInstanceOf(DayClosedError);
  });

  it('locks the day when the manager closes the only open shift, whoever the shift belongs to', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    expect(await closeShift(a, {}, 0, 'M')).toMatchObject({ dayLocked: true });
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toBeDefined();
  });

  it('never locks the day on a cashier close, even the last one', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    expect(await closeShift(a, {}, 0, 'U1')).toMatchObject({ dayLocked: false });
    expect(await db.dayCloses.count()).toBe(0);
    await expect(sell(await openShift('TSTS1', 'U2', 0), 100)).resolves.toBeDefined();
  });

  it('does not lock on a close by someone who is not a manager, or by an unknown id', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const b = await openShift('TSTS1', 'U2', 0);
    expect((await closeShift(a, {}, 0, 'U2')).dayLocked).toBe(false);
    expect((await closeShift(b, {}, 0, 'NOBODY')).dayLocked).toBe(false);
    expect(await db.dayCloses.count()).toBe(0);
  });

  it('does not lock when the last shift is closed by a cashier after the manager closed another', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const b = await openShift('TSTS1', 'U2', 0);
    expect((await closeShift(a, {}, 0, 'M')).dayLocked).toBe(false);
    expect((await closeShift(b, {}, 0, 'U2')).dayLocked).toBe(false); // the cashier's own End shift never locks
    expect(await db.dayCloses.count()).toBe(0);
  });

  it('does not wait for a shift left open on an earlier day, and ignores other shops', async () => {
    await db.shifts.add({ id: 'OLD', storeCode: 'TSTS1', cashierId: 'U9', openedAt: '2026-10-27T04:00:00.000Z', floatPaise: 0 });
    await openShift('TSTS2', 'U2', 0);
    const shift = await openShift('TSTS1', 'U1', 0);
    expect((await closeShift(shift, {}, 0, 'M')).dayLocked).toBe(true);
    expect(await db.dayCloses.get(['TSTS2', '2026-10-29'])).toBeUndefined();
  });

  it('locks the day the shift began on when it is closed after midnight, and leaves the next day open', async () => {
    vi.setSystemTime(new Date('2026-10-29T16:30:00.000Z')); // 22:00 IST, 29 Oct
    const shift = await openShift('TSTS1', 'U1', 0);
    await sell(shift, 10000, 'cash');
    vi.setSystemTime(new Date('2026-10-29T18:50:00.000Z')); // 00:20 IST, 30 Oct
    expect((await closeShift(shift, {}, 0, 'M')).dayLocked).toBe(true);

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
    const shift = await openShift('TSTS1', 'U1', 0);
    const first = await closeShift(shift, { 100: 1 }, 0, 'M');
    vi.setSystemTime(new Date('2026-10-29T08:00:00.000Z'));
    const second = await closeShift(shift, { 500: 9 }, 0, 'M');
    expect(second).toEqual(first);
    expect((await db.shifts.get(shift))?.counted).toBe(10000);
  });

  it('refuses an unknown shift and a bad count', async () => {
    await expect(closeShift('NOPE', {}, 0, 'M')).rejects.toThrow('shift_not_found');
    const shift = await openShift('TSTS1', 'U1', 0);
    await expect(closeShift(shift, { 100: -1 }, 0, 'M')).rejects.toThrow('bad_count');
  });
});

describe('lockDay', () => {
  it('locks the day by the manager once every shift was ended by its cashier, saving the totals', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    const b = await openShift('TSTS1', 'U2', 0);
    await sell(a, 10000, 'cash');
    await sell(a, 20000, 'upi');
    expect((await closeShift(a, {}, 0, 'U1')).dayLocked).toBe(false);
    expect((await closeShift(b, {}, 0, 'U2')).dayLocked).toBe(false);
    expect(await db.dayCloses.count()).toBe(0);

    await lockDay('TSTS1', '2026-10-29', 'M');
    const row = await db.dayCloses.get(['TSTS1', '2026-10-29']);
    expect(row).toMatchObject({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST });
    expect(row?.totals).toMatchObject({ net: 30000, bills: 2 });
    await expect(sell(a, 100)).rejects.toBeInstanceOf(DayClosedError);
  });

  it('refuses while a shift of that day is still open, and writes nothing', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    await openShift('TSTS1', 'U2', 0);
    await closeShift(a, {}, 0, 'U1');
    await expect(lockDay('TSTS1', '2026-10-29', 'M')).rejects.toThrow('shift_open');
    expect(await db.dayCloses.count()).toBe(0);
  });

  it('does not wait for a shift left open on an earlier day, nor for another shop', async () => {
    await db.shifts.add({ id: 'OLD', storeCode: 'TSTS1', cashierId: 'U9', openedAt: '2026-10-27T04:00:00.000Z', floatPaise: 0 });
    await openShift('TSTS2', 'U2', 0);
    await lockDay('TSTS1', '2026-10-29', 'M');
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toBeDefined();
    expect(await db.dayCloses.get(['TSTS2', '2026-10-29'])).toBeUndefined();
  });

  it('is for a manager only', async () => {
    await expect(lockDay('TSTS1', '2026-10-29', 'U1')).rejects.toThrow('not_manager');
    await expect(lockDay('TSTS1', '2026-10-29', 'NOBODY')).rejects.toThrow('not_manager');
    expect(await db.dayCloses.count()).toBe(0);
  });

  it('is safe to call twice: the first lock stands', async () => {
    await lockDay('TSTS1', '2026-10-29', 'M');
    vi.setSystemTime(new Date('2026-10-29T08:00:00.000Z'));
    await lockDay('TSTS1', '2026-10-29', 'M');
    expect(await db.dayCloses.count()).toBe(1);
    expect((await db.dayCloses.get(['TSTS1', '2026-10-29']))?.lockedAt).toBe(NOON_IST);
  });
});

/** A paid bill of TSTS1 on 28 Oct (yesterday), so the shop "sold yesterday". */
async function billYesterday(): Promise<void> {
  await db.bills.add({
    number: 'TSTS1/2627/000001', clientId: 'y1', storeCode: 'TSTS1', counter: 1, cashierId: 'U1', shiftId: 'SH-Y',
    at: '2026-10-28T08:00:00.000Z', gross: 10000, discount: 0, tax: 0, net: 10000, status: 'paid',
  });
}

describe('locking a past day', () => {
  const dayNotClosed = async () => {
    const todos = generateTodos({
      stores: [{ code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' }],
      products: [], movements: [], grns: [], transfers: [], counts: [], claims: [],
      bills: await db.bills.toArray(),
      dayCloses: await db.dayCloses.toArray(),
      nowIso: clockNow(),
    });
    return todos.filter((t) => t.kind === 'day_not_closed');
  };
  const clockNow = () => new Date().toISOString();

  it('clears the "did not close yesterday" to-do for that shop and day, and leaves today unlocked', async () => {
    await billYesterday();
    const [todo] = await dayNotClosed();
    expect(todo).toMatchObject({ storeCode: 'TSTS1', ref: 'TSTS1|2026-10-28', action: { to: '/office/close?day=2026-10-28' } });

    await lockDay('TSTS1', '2026-10-28', 'M');
    expect(await dayNotClosed()).toEqual([]);
    expect(await db.dayCloses.get(['TSTS1', '2026-10-28'])).toMatchObject({ date: '2026-10-28' });
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toBeUndefined();
    const a = await openShift('TSTS1', 'U1', 0);
    await expect(sell(a, 100)).resolves.toBeDefined(); // today still sells
  });

  it('refuses a past day while a shift left open on that day, and for a cashier', async () => {
    await db.shifts.add({ id: 'Y-OPEN', storeCode: 'TSTS1', cashierId: 'U1', openedAt: '2026-10-28T04:00:00.000Z', floatPaise: 0 });
    await expect(lockDay('TSTS1', '2026-10-28', 'M')).rejects.toThrow('shift_open');
    await expect(lockDay('TSTS1', '2026-10-28', 'U1')).rejects.toThrow('not_manager');
    expect(await db.dayCloses.count()).toBe(0);
  });
});

describe('dayLockable', () => {
  it('is false for today when the shop has had no shift today', async () => {
    expect(await dayLockable('TSTS1', '2026-10-29')).toBe(false);
    await db.shifts.add({ id: 'OLD', storeCode: 'TSTS1', cashierId: 'U1', openedAt: '2026-10-27T04:00:00.000Z', floatPaise: 0, closedAt: '2026-10-27T15:00:00.000Z' });
    expect(await dayLockable('TSTS1', '2026-10-29')).toBe(false); // an earlier day's shift does not count
  });

  it('is true for today once a shift began today and none is open, false while one is open', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    expect(await dayLockable('TSTS1', '2026-10-29')).toBe(false);
    await closeShift(a, {}, 0, 'U1');
    expect(await dayLockable('TSTS1', '2026-10-29')).toBe(true);
  });

  it('is false once the day is locked', async () => {
    const a = await openShift('TSTS1', 'U1', 0);
    await closeShift(a, {}, 0, 'U1');
    await lockDay('TSTS1', '2026-10-29', 'M');
    expect(await dayLockable('TSTS1', '2026-10-29')).toBe(false);
  });

  it('is true for a past day with no open shift on it, even with no shift record', async () => {
    expect(await dayLockable('TSTS1', '2026-10-28')).toBe(true);
    await db.shifts.add({ id: 'Y-OPEN', storeCode: 'TSTS1', cashierId: 'U1', openedAt: '2026-10-28T04:00:00.000Z', floatPaise: 0 });
    expect(await dayLockable('TSTS1', '2026-10-28')).toBe(false);
  });
});
