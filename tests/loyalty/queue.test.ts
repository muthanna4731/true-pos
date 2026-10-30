import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { LoyaltyError, type LoyaltyClient } from '../../src/loyalty/client';
import { DemoLoyaltyClient, setLoyaltyEnabled } from '../../src/loyalty/demoClient';
import { flushLoyaltyQueue } from '../../src/loyalty/queue';

const NOON_IST = '2026-10-29T06:30:00.000Z';
const RAVI = '7K3M9QX2RA';
const STORE = 'TSTS1';

const earnItem = (billRef: string, billRupees = 375) => ({ memberCode: RAVI, billRupees, billRef, storeCode: STORE });

function stub(overrides: Partial<LoyaltyClient>): LoyaltyClient {
  const unused = () => Promise.reject(new Error('not used in this test'));
  return { flags: unused, memberInfo: unused, earn: unused, redeem: unused, reverse: unused, rewards: unused, ...overrides };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await db.loyaltyMembers.add({ code: RAVI, name: 'Ravi', phone: '9845014821', createdAt: '2026-10-01T00:00:00.000Z' });
  await setLoyaltyEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('flushLoyaltyQueue', () => {
  it('sends a queued earn, empties the queue and adds the points', async () => {
    await db.loyaltyQueue.add(earnItem('TSTS1/26-27/100001'));
    expect(await flushLoyaltyQueue(new DemoLoyaltyClient())).toEqual({ sent: 1, dropped: 0, kept: 0 });
    expect(await db.loyaltyQueue.count()).toBe(0);
    expect((await db.loyaltyLedger.toArray()).map((r) => r.points)).toEqual([3]);
  });

  it('drops an earn when loyalty was switched off meanwhile, and leaves the ledger alone', async () => {
    await db.loyaltyQueue.add(earnItem('TSTS1/26-27/100001'));
    await setLoyaltyEnabled(false);
    expect(await flushLoyaltyQueue(new DemoLoyaltyClient())).toEqual({ sent: 0, dropped: 1, kept: 0 });
    expect(await db.loyaltyQueue.count()).toBe(0);
    expect(await db.loyaltyLedger.count()).toBe(0);
    expect(await db.kv.get('loyaltyErrors')).toBeUndefined(); // a switch-off is expected, not an error to report
  });

  it('keeps everything and stops at the first network error', async () => {
    await db.loyaltyQueue.bulkAdd([earnItem('A/1'), earnItem('A/2')]);
    const earn = vi.fn().mockRejectedValue(new LoyaltyError('network'));
    expect(await flushLoyaltyQueue(stub({ earn }))).toEqual({ sent: 0, dropped: 0, kept: 2 });
    expect(earn).toHaveBeenCalledTimes(1);
    expect(await db.loyaltyQueue.count()).toBe(2);
  });

  it('sends what it can before a network error and counts the rest as kept', async () => {
    await db.loyaltyQueue.bulkAdd([earnItem('A/1'), earnItem('A/2'), earnItem('A/3')]);
    const earn = vi
      .fn()
      .mockResolvedValueOnce({ maskedName: 'R', pointsAdded: 3, balance: 3 })
      .mockRejectedValue(new LoyaltyError('network'));
    expect(await flushLoyaltyQueue(stub({ earn }))).toEqual({ sent: 1, dropped: 0, kept: 2 });
    expect((await db.loyaltyQueue.toArray()).map((i) => ('billRef' in i ? i.billRef : ''))).toEqual(['A/2', 'A/3']);
  });

  it('treats a failure that is not a loyalty error as a network problem: keep and stop', async () => {
    await db.loyaltyQueue.add(earnItem('A/1'));
    const earn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await flushLoyaltyQueue(stub({ earn }))).toEqual({ sent: 0, dropped: 0, kept: 1 });
    expect(await db.loyaltyQueue.count()).toBe(1);
  });

  it('drops a duplicate_bill without recording it', async () => {
    await db.loyaltyQueue.add(earnItem('A/1'));
    const earn = vi.fn().mockRejectedValue(new LoyaltyError('duplicate_bill'));
    expect(await flushLoyaltyQueue(stub({ earn }))).toEqual({ sent: 0, dropped: 1, kept: 0 });
    expect(await db.kv.get('loyaltyErrors')).toBeUndefined();
  });

  it('drops any other refusal and records it in kv.loyaltyErrors', async () => {
    await db.loyaltyQueue.bulkAdd([earnItem('A/1', 50), earnItem('A/2')]);
    const client = new DemoLoyaltyClient();
    expect(await flushLoyaltyQueue(client)).toEqual({ sent: 1, dropped: 1, kept: 0 });
    const errors = (await db.kv.get('loyaltyErrors'))?.value as { code: string; billRef: string; at: string }[];
    expect(errors).toEqual([expect.objectContaining({ code: 'bill_out_of_range', billRef: 'A/1', at: NOON_IST })]);
  });

  it('sends a reverse with the store of the bill it names', async () => {
    await db.bills.add({
      number: 'TSTS1/26-27/100001', clientId: 'c1', storeCode: STORE, counter: 1, cashierId: 'U1', shiftId: 'S1',
      at: NOON_IST, memberCode: RAVI, gross: 37500, discount: 0, tax: 0, net: 37500, status: 'void',
    });
    const client = new DemoLoyaltyClient();
    await client.earn(RAVI, 375, 'TSTS1/26-27/100001', STORE);
    await db.loyaltyQueue.add({ reverse: 'TSTS1/26-27/100001' });
    expect(await flushLoyaltyQueue(client)).toEqual({ sent: 1, dropped: 0, kept: 0 });
    expect((await db.loyaltyLedger.toArray()).reduce((s, r) => s + r.points, 0)).toBe(0);
  });

  it('drops a reverse whose bill is not in the database', async () => {
    await db.loyaltyQueue.add({ reverse: 'NOPE/1' });
    const reverse = vi.fn();
    expect(await flushLoyaltyQueue(stub({ reverse }))).toEqual({ sent: 0, dropped: 1, kept: 0 });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('is safe when two flushes run at once: each earn is sent once', async () => {
    await db.loyaltyQueue.add(earnItem('A/1'));
    const earn = vi.fn().mockResolvedValue({ maskedName: 'R', pointsAdded: 3, balance: 3 });
    const client = stub({ earn });
    await Promise.all([flushLoyaltyQueue(client), flushLoyaltyQueue(client)]);
    expect(earn).toHaveBeenCalledTimes(1);
  });
});
