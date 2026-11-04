import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { pendingCount } from '../../src/db/outbox';
import { recordSale, voidBill, type SaleInput } from '../../src/db/sales';
import { setPractice } from '../../src/db/settings';
import { connectDevice, currentDevice, setSyncConfig } from '../../src/sync/client';
import { applyChanges, syncNow, syncStatus } from '../../src/sync/engine';
import { setTracking, type SyncOp } from '../../src/sync/track';

const URL = 'https://cloud.test';
const ME = 'device-me';
const OTHER = 'device-other';

interface Row {
  seq: number;
  clientId: string;
  device: string;
  ops: SyncOp[];
}

/** A cloud that keeps the rules of supabase/migrations: one row per client id, pulled in seq order. */
function fakeCloud() {
  const rows: Row[] = [];
  let reject: number | null = null;
  const pushes: { id: string; ops: SyncOp[] }[][] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes('/auth/v1/token')) {
      if (body.password !== 'right') return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 3600,
        user: { id: ME, email: 'c2@devices', app_metadata: { tenant: 'ts', store: 'TSTS1', counter: 2, label: 'TS1 counter 2' } },
      });
    }
    if (reject !== null) return json({ message: 'no' }, reject);
    if (url.endsWith('/rpc/push_changes')) {
      pushes.push(body.batch);
      let n = 0;
      for (const c of body.batch as { id: string; ops: SyncOp[] }[]) {
        if (rows.some((r) => r.clientId === c.id)) continue;
        rows.push({ seq: rows.length + 1, clientId: c.id, device: ME, ops: c.ops });
        n += 1;
      }
      return json(n);
    }
    if (url.endsWith('/rpc/pull_changes')) {
      return json(rows.filter((r) => r.seq > body.since).slice(0, body.lim).map((r) => ({ seq: r.seq, mine: r.device === ME, ops: r.ops })));
    }
    return json({ message: 'not found' }, 404);
  });
  return {
    rows,
    pushes,
    fetchFn,
    fromOther(ops: SyncOp[]) {
      rows.push({ seq: rows.length + 1, clientId: `other-${rows.length}`, device: OTHER, ops });
    },
    refuse(status: number | null) {
      reject = status;
    },
  };
}

function sale(over: Partial<SaleInput> = {}): SaleInput {
  return {
    clientId: 'c-1',
    storeCode: 'TSTS1',
    counter: 2,
    cashierId: 'U1',
    shiftId: 'S1',
    lines: [{ productId: 'P0090', qty: 2, mrp: 5500, discount: 0, tax: 0 }],
    payments: [{ mode: 'cash', amount: 11000 }],
    practice: false,
    ...over,
  };
}

let cloud: ReturnType<typeof fakeCloud>;

beforeEach(async () => {
  await resetDb();
  cloud = fakeCloud();
  vi.stubGlobal('fetch', cloud.fetchFn);
  setSyncConfig({ url: URL, anonKey: 'anon' });
});

afterEach(() => {
  setTracking(true);
  setSyncConfig(null);
  vi.unstubAllGlobals();
});

describe('change tracking', () => {
  it('queues a sale as one transaction: the bill by its number, appended rows without their local id', async () => {
    const bill = await recordSale(sale());
    const rows = await db.outbox.toArray();
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
    const ops = rows.flatMap((r) => r.ops);
    expect(ops.map((o) => `${o.tb}:${o.t}`).sort()).toEqual(['billLines:ins', 'bills:put', 'movements:ins', 'payments:ins']);
    const line = ops.find((o) => o.tb === 'billLines');
    expect(line && 'v' in line && 'id' in line.v).toBe(false);
    expect(ops.find((o) => o.tb === 'bills')).toMatchObject({ v: { number: bill.number } });
    // each device numbers its own bills: the counter row stays here
    expect(rows.some((r) => r.table === 'counters')).toBe(false);
  });

  it('shares the practice switch but not other device settings', async () => {
    await setPractice('TSTS1', true);
    await db.kv.put({ key: 'clockOffsetDays', value: 3 });
    const ops = (await db.outbox.toArray()).flatMap((r) => r.ops);
    expect(ops).toEqual([{ tb: 'kv', t: 'put', v: { key: 'practice:TSTS1', value: true } }]);
  });

  it('queues nothing when tracking is off, or when the transaction fails', async () => {
    setTracking(false);
    await recordSale(sale());
    expect(await db.outbox.count()).toBe(0);
    setTracking(true);
    await expect(
      db.transaction('rw', db.offers, async () => {
        await db.offers.put({ code: 'OFFX' } as never);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('sync engine', () => {
  it('stays local until the device is connected', async () => {
    await recordSale(sale());
    await syncNow();
    expect(syncStatus().state).toBe('local');
    expect(cloud.fetchFn).not.toHaveBeenCalled();
    expect(await pendingCount()).toBe(1);
  });

  it('refuses a wrong device login, and remembers a right one', async () => {
    await expect(connectDevice('c2@devices', 'wrong')).rejects.toThrow('bad_login');
    expect(await currentDevice()).toBeNull();
    const device = await connectDevice('c2@devices', 'right');
    expect(device).toMatchObject({ store: 'TSTS1', counter: 2, label: 'TS1 counter 2' });
    expect(await currentDevice()).toEqual(device);
  });

  it('sends waiting bills as whole transactions, then forgets them', async () => {
    await connectDevice('c2@devices', 'right');
    const a = await recordSale(sale());
    await voidBill(a.number, 'U-M');
    expect(await pendingCount()).toBe(2);
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect(cloud.rows).toHaveLength(2);
    expect(cloud.rows[0].ops.map((o) => o.tb).sort()).toEqual(['billLines', 'bills', 'movements', 'payments']);
    expect(cloud.rows[1].ops.find((o) => o.tb === 'bills')).toMatchObject({ v: { status: 'void' } });
    expect(syncStatus().state).toBe('idle');
  });

  it('a resend after a lost reply is not doubled in the cloud', async () => {
    await connectDevice('c2@devices', 'right');
    await recordSale(sale());
    const [row] = await db.outbox.toArray();
    await syncNow();
    // the reply was lost: the device still has the row and sends it again
    await db.outbox.add({ ...row, id: undefined });
    await syncNow();
    expect(cloud.rows).toHaveLength(1);
  });

  it("applies other devices' changes, skips its own appended rows, and saves the cursor", async () => {
    await connectDevice('c2@devices', 'right');
    await recordSale(sale());
    await syncNow();
    expect(await db.movements.count()).toBe(1); // own movement came back and was not added twice
    cloud.fromOther([
      { tb: 'bills', t: 'put', v: { number: 'TSTS1/26-27/100001', clientId: 'x', storeCode: 'TSTS1', counter: 1, status: 'paid', at: '2026-11-03T05:00:00.000Z' } },
      { tb: 'movements', t: 'ins', v: { storeCode: 'TSTS1', productId: 'P0090', qty: -1, kind: 'sale', ref: 'TSTS1/26-27/100001', at: '2026-11-03T05:00:00.000Z' } },
      { tb: 'kv', t: 'put', v: { key: 'practice:TSTS2', value: true } },
      { tb: 'counters', t: 'put', v: { storeCode: 'TSTS1', counter: 1, next: 5 } },
    ]);
    await syncNow();
    expect(await db.bills.get('TSTS1/26-27/100001')).toBeDefined();
    expect(await db.movements.count()).toBe(2);
    expect((await db.kv.get('practice:TSTS2'))?.value).toBe(true);
    expect(await db.counters.get(['TSTS1', 1])).toBeUndefined(); // never taken from the cloud
    expect((await db.kv.get('sync:cursor'))?.value).toBe(2);
    // pulling again changes nothing
    await syncNow();
    expect(await db.movements.count()).toBe(2);
  });

  it('a row changed here and not sent yet is not overwritten by an older value from the cloud', async () => {
    await connectDevice('c2@devices', 'right');
    await setPractice('TSTS1', true);
    cloud.fromOther([{ tb: 'kv', t: 'put', v: { key: 'practice:TSTS1', value: false } }]);
    cloud.refuse(500);
    await expect(syncNow()).rejects.toThrow();
    cloud.refuse(null);
    // push first, so the local change lands after the older one and wins everywhere
    await syncNow();
    expect((await db.kv.get('practice:TSTS1'))?.value).toBe(true);
    expect(cloud.rows.map((r) => r.ops[0]).at(-1)).toMatchObject({ v: { value: true } });
  });

  it('reports a refused device as a problem and keeps the bills waiting', async () => {
    await connectDevice('c2@devices', 'right');
    await recordSale(sale());
    cloud.refuse(401);
    await expect(syncNow()).rejects.toThrow('not_connected');
    expect(syncStatus()).toMatchObject({ state: 'error', error: 'not_connected' });
    expect(await pendingCount()).toBe(1);
  });

  it('never splits a transaction across two pushes', async () => {
    await connectDevice('c2@devices', 'right');
    // 450 single writes in one transaction: more outbox rows than one push reads
    await db.transaction('rw', db.kv, async () => {
      for (let i = 0; i < 450; i += 1) await db.kv.put({ key: `practice:S${i}`, value: true });
    });
    await recordSale(sale());
    expect(await db.outbox.count()).toBe(454);
    await syncNow();
    expect(cloud.rows.map((r) => r.ops.length)).toEqual([450, 4]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('applying pulled rows keeps a local change that is still waiting', async () => {
    await setPractice('TSTS1', true);
    await applyChanges([{ seq: 7, mine: false, ops: [{ tb: 'kv', t: 'put', v: { key: 'practice:TSTS1', value: false } }] }]);
    expect((await db.kv.get('practice:TSTS1'))?.value).toBe(true);
    expect((await db.kv.get('sync:cursor'))?.value).toBe(7);
    // applying is not itself queued
    expect((await db.outbox.toArray()).flatMap((r) => r.ops)).toHaveLength(1);
  });
});
