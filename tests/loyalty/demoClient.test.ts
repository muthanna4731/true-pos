import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { LoyaltyError } from '../../src/loyalty/client';
import { DemoLoyaltyClient, LOYALTY_DEFAULTS, setLoyaltyEnabled } from '../../src/loyalty/demoClient';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const RAVI = '7K3M9QX2RA';
const STORE = 'TSTS1';

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof LoyaltyError ? e.code : `other:${String(e)}`;
  }
}

const balance = async (member = RAVI): Promise<number> =>
  (await db.loyaltyLedger.where('memberCode').equals(member).toArray()).reduce((s, r) => s + r.points, 0);

let client: DemoLoyaltyClient;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await db.loyaltyMembers.bulkAdd([
    { code: RAVI, name: 'Ravi', phone: '9845014821', createdAt: '2026-10-01T00:00:00.000Z' },
    { code: 'B4N8TC5WZ6', name: 'Meena', phone: '9000000002', createdAt: '2026-10-01T00:00:00.000Z' },
  ]);
  await db.rewards.bulkAdd([
    { id: 'R-50', name: '₹50 off next visit', cost: 100, active: true },
    { id: 'R-150', name: '₹150 off next visit', cost: 250, active: true },
    { id: 'R-OLD', name: 'Old reward', cost: 10, active: false },
  ]);
  await setLoyaltyEnabled(true);
  client = new DemoLoyaltyClient();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DemoLoyaltyClient: switch', () => {
  it('is off when no config was ever saved', async () => {
    await resetDb();
    expect(await client.flags()).toEqual({ loyalty: false });
  });

  it('follows the saved config and keeps the rules of the brief', async () => {
    expect(await client.flags()).toEqual({ loyalty: true });
    expect((await db.kv.get('loyaltyConfig'))?.value).toEqual({ ...LOYALTY_DEFAULTS, loyaltyEnabled: true });
    expect(LOYALTY_DEFAULTS).toEqual({
      loyaltyEnabled: false,
      earnPer100: 1,
      minBill: 100,
      maxBill: 50000,
      maxEarnsPerDay: 2,
      billRefPattern: '^[A-Z0-9/-]{1,20}$',
    });
  });

  it('setLoyaltyEnabled writes both the server config and the POS-side flag', async () => {
    await setLoyaltyEnabled(false);
    expect(await client.flags()).toEqual({ loyalty: false });
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: false });
  });
});

describe('DemoLoyaltyClient: earn', () => {
  it('earns 3 points on a 375 rupee bill and returns the masked name and balance', async () => {
    await db.loyaltyLedger.add({ memberCode: RAVI, points: 240, kind: 'earn', storeCode: STORE, fy: '26-27', billRef: 'SEED-1', at: '2026-10-19T00:00:00.000Z' });
    const res = await client.earn('TS1:7K3M-9QX2RA', 375, 'TSTS1/26-27/100001', STORE);
    expect(res).toEqual({ maskedName: 'R••• ··4821', pointsAdded: 3, balance: 243 });
    const row = (await db.loyaltyLedger.toArray()).find((r) => r.billRef === 'TSTS1/26-27/100001');
    expect(row).toMatchObject({ memberCode: RAVI, points: 3, kind: 'earn', storeCode: STORE, fy: '26-27', at: NOON_IST });
  });

  it('refuses the same bill again with duplicate_bill', async () => {
    await client.earn(RAVI, 375, 'TSTS1/26-27/100001', STORE);
    expect(await code(client.earn('B4N8TC5WZ6', 375, 'TSTS1/26-27/100001', STORE))).toBe('duplicate_bill');
    expect(await db.loyaltyLedger.count()).toBe(1);
  });

  it('allows the same bill number at another store', async () => {
    await client.earn(RAVI, 375, 'X/1', 'TSTS1');
    expect(await code(client.earn(RAVI, 375, 'X/1', 'TSTS2'))).toBeUndefined();
  });

  it('refuses bills outside 100 to 50,000 rupees with bill_out_of_range', async () => {
    expect(await code(client.earn(RAVI, 99, 'A/1', STORE))).toBe('bill_out_of_range');
    expect(await code(client.earn(RAVI, 50001, 'A/2', STORE))).toBe('bill_out_of_range');
    expect(await code(client.earn(RAVI, 100, 'A/3', STORE))).toBeUndefined();
    expect(await code(client.earn(RAVI, 50000, 'A/4', STORE))).toBeUndefined();
  });

  it('refuses a bill that earns less than 1 point', async () => {
    await db.kv.put({ key: 'loyaltyConfig', value: { ...LOYALTY_DEFAULTS, loyaltyEnabled: true, minBill: 1 } });
    expect(await code(client.earn(RAVI, 99, 'A/1', STORE))).toBe('bill_out_of_range');
  });

  it('refuses a third earn the same IST day with daily_limit, but not the next day', async () => {
    await client.earn(RAVI, 200, 'A/1', STORE);
    await client.earn(RAVI, 200, 'A/2', STORE);
    expect(await code(client.earn(RAVI, 200, 'A/3', STORE))).toBe('daily_limit');
    // 30 Oct 00:30 IST is 29 Oct 19:00 UTC: a new IST day.
    vi.setSystemTime(new Date('2026-10-29T19:00:00.000Z'));
    expect(await code(client.earn(RAVI, 200, 'A/3', STORE))).toBeUndefined();
  });

  it('counts the day in IST, not UTC', async () => {
    // 29 Oct 23:50 IST and 30 Oct 00:10 IST: two IST days, one UTC day.
    vi.setSystemTime(new Date('2026-10-29T18:20:00.000Z'));
    await client.earn(RAVI, 200, 'A/1', STORE);
    await client.earn(RAVI, 200, 'A/2', STORE);
    vi.setSystemTime(new Date('2026-10-29T18:40:00.000Z'));
    expect(await code(client.earn(RAVI, 200, 'A/3', STORE))).toBeUndefined();
  });

  it('refuses everything with loyalty_off when the switch is off', async () => {
    await setLoyaltyEnabled(false);
    expect(await code(client.earn(RAVI, 375, 'A/1', STORE))).toBe('loyalty_off');
    expect(await db.loyaltyLedger.count()).toBe(0);
  });

  it('checks in the order of the app: off, member, missing ref, bad ref, duplicate, range', async () => {
    await setLoyaltyEnabled(false);
    expect(await code(client.earn('ZZZZZZZZZZ', 50, '', STORE))).toBe('loyalty_off');
    await setLoyaltyEnabled(true);
    expect(await code(client.earn('ZZZZZZZZZZ', 50, '', STORE))).toBe('member_not_found');
    expect(await code(client.earn(RAVI, 50, '   ', STORE))).toBe('missing_bill_ref');
    expect(await code(client.earn(RAVI, 50, 'bad ref!', STORE))).toBe('bad_bill_ref');
    expect(await code(client.earn(RAVI, 50, 'A'.repeat(21), STORE))).toBe('bad_bill_ref');
    await client.earn(RAVI, 200, 'A/1', STORE);
    expect(await code(client.earn(RAVI, 50, 'A/1', STORE))).toBe('duplicate_bill');
    expect(await code(client.earn(RAVI, 50, 'A/2', STORE))).toBe('bill_out_of_range');
  });

  it('upper-cases the bill ref and drops spaces before checking, as the app does', async () => {
    await client.earn(RAVI, 200, 'ts1 /1', STORE);
    expect((await db.loyaltyLedger.toArray())[0].billRef).toBe('TS1/1');
    expect(await code(client.earn(RAVI, 200, 'TS1/1', STORE))).toBe('duplicate_bill');
  });
});

describe('DemoLoyaltyClient: member info and rewards', () => {
  it('returns the masked name and points', async () => {
    await client.earn(RAVI, 375, 'A/1', STORE);
    expect(await client.memberInfo(' 7k3m-9qx2ra ')).toEqual({ maskedName: 'R••• ··4821', points: 3 });
  });

  it('refuses an unknown member', async () => {
    expect(await code(client.memberInfo('ZZZZZZZZZZ'))).toBe('member_not_found');
  });

  it('lists only the active rewards', async () => {
    expect((await client.rewards()).map((r) => r.id).sort()).toEqual(['R-150', 'R-50']);
  });
});

describe('DemoLoyaltyClient: redeem', () => {
  beforeEach(async () => {
    await db.loyaltyLedger.add({ memberCode: RAVI, points: 240, kind: 'earn', storeCode: STORE, fy: '26-27', billRef: 'SEED-1', at: '2026-10-19T00:00:00.000Z' });
  });

  it('deducts the cost and returns the balance after', async () => {
    expect(await client.redeem(RAVI, 'R-50', 'req-1', 100)).toEqual({ balance: 140 });
    expect(await balance()).toBe(140);
  });

  it('deducts once when the same requestId comes twice', async () => {
    await client.redeem(RAVI, 'R-50', 'req-1', 100);
    expect(await client.redeem(RAVI, 'R-50', 'req-1', 100)).toEqual({ balance: 140 });
    expect(await balance()).toBe(140);
    expect((await db.loyaltyLedger.toArray()).filter((r) => r.kind === 'redeem')).toHaveLength(1);
  });

  it('refuses with insufficient_points when the balance is below the cost', async () => {
    expect(await code(client.redeem(RAVI, 'R-150', 'req-1', 250))).toBe('insufficient_points');
    expect(await balance()).toBe(240);
  });

  it('refuses when the loyalty switch is off', async () => {
    await setLoyaltyEnabled(false);
    expect(await code(client.redeem(RAVI, 'R-50', 'req-1', 100))).toBe('loyalty_off');
  });

  it('refuses an unknown member, an unknown or inactive reward, and a changed cost', async () => {
    expect(await code(client.redeem('ZZZZZZZZZZ', 'R-50', 'r1', 100))).toBe('member_not_found');
    expect(await code(client.redeem(RAVI, 'R-NOPE', 'r2', 100))).toBe('unknown_reward');
    expect(await code(client.redeem(RAVI, 'R-OLD', 'r3', 10))).toBe('reward_inactive');
    expect(await code(client.redeem(RAVI, 'R-50', 'r4', 90))).toBe('cost_changed');
    expect(await balance()).toBe(240);
  });
});

describe('DemoLoyaltyClient: reverse', () => {
  it('takes back the points of a 375 rupee bill, once', async () => {
    await client.earn(RAVI, 375, 'TSTS1/26-27/100001', STORE);
    expect(await balance()).toBe(3);
    await client.reverse('TSTS1/26-27/100001', STORE);
    expect(await balance()).toBe(0);
    const adjusts = (await db.loyaltyLedger.toArray()).filter((r) => r.kind === 'adjust');
    expect(adjusts).toEqual([expect.objectContaining({ points: -3, memberCode: RAVI, storeCode: STORE, billRef: 'TSTS1/26-27/100001' })]);
    await client.reverse('TSTS1/26-27/100001', STORE);
    expect(await balance()).toBe(0);
    expect(await db.loyaltyLedger.count()).toBe(2);
  });

  it('does nothing when the bill never earned (no negative row)', async () => {
    await client.reverse('TSTS1/26-27/100002', STORE);
    expect(await db.loyaltyLedger.count()).toBe(0);
  });

  it('does not touch another store with the same bill number', async () => {
    await client.earn(RAVI, 375, 'X/1', 'TSTS1');
    await client.reverse('X/1', 'TSTS2');
    expect(await balance()).toBe(3);
  });

  it('still works when loyalty has been switched off (it only corrects an earn)', async () => {
    await client.earn(RAVI, 375, 'X/1', STORE);
    await setLoyaltyEnabled(false);
    await client.reverse('X/1', STORE);
    expect(await balance()).toBe(0);
  });
});
