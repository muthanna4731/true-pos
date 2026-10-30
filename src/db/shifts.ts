import type { PayMode, Paise, Shift } from '../domain/types';
import { cashFromNotes } from '../domain/cash';
import { newId } from '../domain/id';
import { clock, istDate } from '../domain/time';
import { db } from './db';
import { loadDayTotals } from './dayData';

/** The till float a new shift starts with (₹2,000), as in the seed. */
export const DEFAULT_FLOAT: Paise = 200000;

/** Start a shift and return its id. The caller checks `currentShift` first. */
export async function openShift(storeCode: string, cashierId: string, floatPaise: Paise = DEFAULT_FLOAT): Promise<string> {
  const openedAt = clock.now();
  const id = `SH-${storeCode}-${istDate(openedAt).replaceAll('-', '')}-${newId().slice(0, 8)}`;
  await db.shifts.add({ id, storeCode, cashierId, openedAt, floatPaise });
  return id;
}

/** The shift this person still has open at this shop, if any. */
export function currentShift(storeCode: string, cashierId: string): Promise<Shift | undefined> {
  return db.shifts
    .where('cashierId')
    .equals(cashierId)
    .filter((s) => s.storeCode === storeCode && s.closedAt === undefined)
    .first();
}

/** What a shift took by payment mode: paid bills only, never practice or void. */
export async function shiftTakings(shiftId: string): Promise<Record<PayMode, Paise>> {
  const takings: Record<PayMode, Paise> = { cash: 0, upi: 0, card: 0 };
  const bills = await db.bills.where('shiftId').equals(shiftId).filter((b) => b.status === 'paid').toArray();
  const payments = await db.payments.where('billNumber').anyOf(bills.map((b) => b.number)).toArray();
  for (const p of payments) takings[p.mode] += p.amount;
  return takings;
}

/** Cash that should be in the drawer: the float plus the cash payments of the shift's paid bills. */
export async function expectedCash(shiftId: string): Promise<Paise> {
  const shift = await db.shifts.get(shiftId);
  if (!shift) throw new Error('shift_not_found');
  return shift.floatPaise + (await shiftTakings(shiftId)).cash;
}

export interface ShiftClose {
  expected: Paise;
  counted: Paise;
  diff: Paise;
  dayLocked: boolean;
}

function validCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Close a shift with the cash counted (notes by rupee value, plus coins in paise). When it is the last shop shift
 * still open for the day, the day is locked in the same transaction and its figures are saved. Safe to call twice.
 */
export function closeShift(shiftId: string, counts: Record<number, number>, coins: Paise): Promise<ShiftClose> {
  if (!Object.values(counts).every(validCount) || !validCount(coins)) return Promise.reject(new Error('bad_count'));
  return db.transaction('rw', [db.shifts, db.bills, db.payments, db.billLines, db.products, db.dayCloses], async () => {
    const shift = await db.shifts.get(shiftId);
    if (!shift) throw new Error('shift_not_found');
    if (shift.closedAt !== undefined) {
      const locked = (await db.dayCloses.get([shift.storeCode, istDate(shift.closedAt)])) !== undefined;
      return { expected: shift.expected ?? 0, counted: shift.counted ?? 0, diff: shift.diff ?? 0, dayLocked: locked };
    }

    const now = clock.now();
    const day = istDate(now);
    const expected = shift.floatPaise + (await shiftTakings(shiftId)).cash;
    const counted = cashFromNotes(counts, coins);
    const diff = counted - expected;
    await db.shifts.update(shiftId, { closedAt: now, counted, expected, diff });

    // Shifts left open on an earlier day do not hold today's lock back.
    const othersOpen = await db.shifts
      .where('storeCode')
      .equals(shift.storeCode)
      .filter((s) => s.id !== shiftId && s.closedAt === undefined && istDate(s.openedAt) === day)
      .count();
    if (othersOpen > 0) return { expected, counted, diff, dayLocked: false };

    if (!(await db.dayCloses.get([shift.storeCode, day]))) {
      await db.dayCloses.add({ storeCode: shift.storeCode, date: day, lockedAt: now, totals: await loadDayTotals(shift.storeCode, day) });
    }
    return { expected, counted, diff, dayLocked: true };
  });
}
