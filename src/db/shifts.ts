import type { Paise, Shift } from '../domain/types';
import { newId } from '../domain/id';
import { clock, istDate } from '../domain/time';
import { db } from './db';

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
