import type { Offer } from '../domain/types';
import { clock, istDate } from '../domain/time';
import { db } from './db';

/** What the owner fills in; the code is made here. */
export type NewOffer = Omit<Offer, 'code' | 'createdBy'>;

const DAY_MS = 86400000;
const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

function check(o: NewOffer): void {
  if (o.type === 'store' ? !o.productId : !o.brand) throw new Error('offer_target');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.from) || !/^\d{4}-\d{2}-\d{2}$/.test(o.to) || o.to < o.from) throw new Error('offer_dates');
  const whole = (n: number | undefined): boolean => Number.isInteger(n) && (n ?? 0) > 0;
  if (o.discountType === 'amount' ? !whole(o.amountPerUnit) : !whole(o.buyQty) || !whole(o.freeQty)) throw new Error('offer_amount');
}

/** Save a new offer and return its code (`OFF001`, `OFF002`...). */
export function createOffer(offer: NewOffer, createdBy: string): Promise<string> {
  check(offer);
  return db.transaction('rw', db.offers, async () => {
    const used = new Set(await db.offers.toCollection().primaryKeys());
    let n = used.size + 1;
    while (used.has(`OFF${String(n).padStart(3, '0')}`)) n += 1;
    const code = `OFF${String(n).padStart(3, '0')}`;
    await db.offers.add({ ...offer, code, createdBy });
    return code;
  });
}

/**
 * Stop an offer: it last applied yesterday. The row stays, so old bills and the discounts report still know it.
 * An offer that has not started yet is ended on its first day and never applies. Safe to call twice.
 */
export async function endOffer(code: string): Promise<void> {
  await db.transaction('rw', db.offers, async () => {
    const o = await db.offers.get(code);
    if (!o) throw new Error('offer_not_found');
    const last = dayBefore(istDate(clock.now()));
    if (o.to <= last) return;
    await db.offers.update(code, { to: last, from: o.from > last ? last : o.from });
  });
}
