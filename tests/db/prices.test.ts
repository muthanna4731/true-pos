import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { priceAt, pushPrices } from '../../src/db/stockOps';
import { priceInForce } from '../../src/domain/prices';

const A = 'P0001';
const row = (mrp: number, effectiveFrom: string) => ({ productId: A, mrp, purchase: mrp / 2, aroed: 0, cess: 0, effectiveFrom });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T06:30:00.000Z'));
  await resetDb();
});
afterEach(() => vi.useRealTimers());

describe('pushPrices + priceAt', () => {
  it('an MRP change effective tomorrow leaves today unchanged; tomorrow shows it; the history keeps both', async () => {
    await pushPrices([row(50000, '2026-04-01')], 'U-OFFICE');
    expect(await pushPrices([row(52000, '2026-10-30')], 'U-OFFICE')).toBe(1);

    expect((await priceAt(A, '2026-10-29')).mrp).toBe(50000);
    vi.setSystemTime(new Date('2026-10-30T06:30:00.000Z'));
    expect((await priceAt(A, '2026-10-30')).mrp).toBe(52000);

    const history = await db.prices.where('productId').equals(A).toArray();
    expect(history.map((p) => p.mrp)).toEqual([50000, 52000]);
    expect(history.every((p) => p.pushedBy === 'U-OFFICE')).toBe(true);
  });

  it('never updates an existing row: pushing the same day again adds a row', async () => {
    await pushPrices([row(50000, '2026-04-01')], 'U1');
    const first = (await db.prices.toArray())[0];
    await pushPrices([row(51000, '2026-04-01')], 'U2');
    expect(await db.prices.get(first.id!)).toEqual(first);
    expect(await db.prices.count()).toBe(2);
    // A same-day correction wins everywhere, the till included.
    expect((await priceAt(A, '2026-04-01')).mrp).toBe(51000);
    expect(priceInForce(await db.prices.toArray(), '2026-04-01').get(A)).toBe(51000);
  });

  it('refuses a bad date and a product with no started price', async () => {
    await expect(pushPrices([row(1, '30/10/2026')], 'U')).rejects.toThrow('bad_day');
    await pushPrices([row(50000, '2026-11-01')], 'U');
    await expect(priceAt(A, '2026-10-29')).rejects.toThrow('no_price');
  });
});
