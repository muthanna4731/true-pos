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

/** Shifts of the shop that began on this IST day and are still open. Shifts left open from another day do not count. */
function openShiftsOfDay(storeCode: string, day: string, exceptShiftId?: string): Promise<number> {
  return db.shifts
    .where('storeCode')
    .equals(storeCode)
    .filter((s) => s.id !== exceptShiftId && s.closedAt === undefined && istDate(s.openedAt) === day)
    .count();
}

/** Save the day's figures and shut it to sales; a day already locked keeps its first lock. Call inside a transaction on shifts and the tables the totals read. */
async function writeDayClose(storeCode: string, day: string, lockedAt: string): Promise<void> {
  if (await db.dayCloses.get([storeCode, day])) return;
  await db.dayCloses.add({ storeCode, date: day, lockedAt, totals: await loadDayTotals(storeCode, day) });
}

function validCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Close a shift with the cash counted (notes by rupee value, plus coins in paise). Only a close by a manager can lock
 * the day: when `closedBy` is a manager and no other shift of the shop that began on the same IST day is still
 * open, the shift's own day is locked in the same transaction and its figures are saved. A cashier closing their
 * own shift never locks. Safe to call twice.
 */
export function closeShift(shiftId: string, counts: Record<number, number>, coins: Paise, closedBy: string): Promise<ShiftClose> {
  if (!Object.values(counts).every(validCount) || !validCount(coins)) return Promise.reject(new Error('bad_count'));
  return db.transaction('rw', [db.shifts, db.users, db.bills, db.payments, db.billLines, db.products, db.dayCloses], async () => {
    const shift = await db.shifts.get(shiftId);
    if (!shift) throw new Error('shift_not_found');
    // The day a shift belongs to is the day it began, even if it is closed after midnight.
    const day = istDate(shift.openedAt);
    if (shift.closedAt !== undefined) {
      const locked = (await db.dayCloses.get([shift.storeCode, day])) !== undefined;
      return { expected: shift.expected ?? 0, counted: shift.counted ?? 0, diff: shift.diff ?? 0, dayLocked: locked };
    }

    const now = clock.now();
    const expected = shift.floatPaise + (await shiftTakings(shiftId)).cash;
    const counted = cashFromNotes(counts, coins);
    const diff = counted - expected;
    await db.shifts.update(shiftId, { closedAt: now, counted, expected, diff });

    if ((await db.users.get(closedBy))?.role !== 'manager') return { expected, counted, diff, dayLocked: false };

    if ((await openShiftsOfDay(shift.storeCode, day, shiftId)) > 0) return { expected, counted, diff, dayLocked: false };

    await writeDayClose(shift.storeCode, day, now);
    return { expected, counted, diff, dayLocked: true };
  });
}

/**
 * A manager locks the shop's day once every shift of that day is closed (a cashier's own End shift never locks it).
 * Refused with `shift_open` while a shift that began that day is still open, and with `not_manager` for anyone else.
 * Safe to call twice.
 */
export function lockDay(storeCode: string, day: string, lockedBy: string): Promise<void> {
  return db.transaction('rw', [db.shifts, db.users, db.bills, db.payments, db.billLines, db.products, db.dayCloses], async () => {
    if ((await db.users.get(lockedBy))?.role !== 'manager') throw new Error('not_manager');
    if ((await openShiftsOfDay(storeCode, day)) > 0) throw new Error('shift_open');
    await writeDayClose(storeCode, day, clock.now());
  });
}

/**
 * Whether the manager may be offered [Lock day] for this shop and day: the day is not locked yet and no shift that
 * began on it is still open. For today there must also have been a shift, so a shop before its opening cannot be
 * locked by one tap; a past day is the manager's call (the shop's bills flagged it).
 */
export async function dayLockable(storeCode: string, day: string): Promise<boolean> {
  if (await db.dayCloses.get([storeCode, day])) return false;
  if ((await openShiftsOfDay(storeCode, day)) > 0) return false;
  if (day !== istDate(clock.now())) return true;
  return (await db.shifts.where('storeCode').equals(storeCode).filter((s) => istDate(s.openedAt) === day).count()) > 0;
}
