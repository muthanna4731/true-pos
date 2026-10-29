import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { flushOutbox, pendingCount } from '../../src/db/outbox';
import { DayClosedError, recordSale, voidBill, type SaleInput } from '../../src/db/sales';
import { onHand } from '../../src/domain/stock';

// 29 Oct 2026, 12:00 IST. The test zone is UTC, so any code using local time instead of IST would differ.
const NOON_IST = '2026-10-29T06:30:00.000Z';

function sale(over: Partial<SaleInput> = {}): SaleInput {
  return {
    clientId: 'c-1',
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId: 'S1',
    lines: [{ productId: 'P0090', qty: 5, mrp: 5500, discount: 0, tax: 0 }],
    payments: [{ mode: 'cash', amount: 27500 }],
    practice: false,
    ...over,
  };
}

const stock = async (store = 'TSTS1', product = 'P0090') => onHand(await db.movements.toArray(), store, product);

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('recordSale', () => {
  it('creates the bill, lines, payment and stock deduction', async () => {
    await db.movements.add({ storeCode: 'TSTS1', productId: 'P0090', qty: 24, kind: 'opening', ref: 'open', at: NOON_IST });
    const bill = await recordSale(sale());
    expect(bill.number).toBe('TSTS1/26-27/100001');
    expect(bill).toMatchObject({ gross: 27500, discount: 0, net: 27500, tax: 0, status: 'paid', at: NOON_IST });
    expect(await stock()).toBe(19);
    expect(await db.billLines.where('billNumber').equals(bill.number).toArray()).toMatchObject([{ qty: 5, mrp: 5500, amount: 27500 }]);
    expect(await db.payments.toArray()).toMatchObject([{ billNumber: bill.number, mode: 'cash', amount: 27500 }]);
    expect(await pendingCount()).toBe(1);
  });

  it('works out net as mrp x qty less discounts, and line amount likewise', async () => {
    const bill = await recordSale(
      sale({
        lines: [
          { productId: 'P0001', qty: 2, mrp: 10000, offerCode: 'EFKA102', discount: 500, tax: 120 },
          { productId: 'P0002', qty: 1, mrp: 3000, discount: 0, tax: 30 },
        ],
        payments: [
          { mode: 'upi', amount: 20000 },
          { mode: 'cash', amount: 2500 },
        ],
      }),
    );
    expect(bill).toMatchObject({ gross: 23000, discount: 500, tax: 150, net: 22500 });
    const lines = await db.billLines.where('billNumber').equals(bill.number).toArray();
    expect(lines.map((l) => l.amount)).toEqual([19500, 3000]);
    expect(lines[0].offerCode).toBe('EFKA102');
  });

  it('dates the bill number by IST financial year, not the machine zone', async () => {
    vi.setSystemTime(new Date('2026-03-31T18:30:00Z')); // 1 April 00:00 IST
    expect((await recordSale(sale())).number).toBe('TSTS1/26-27/100001');
    vi.setSystemTime(new Date('2026-03-31T18:29:59Z')); // 31 March 23:59 IST
    expect((await recordSale(sale({ clientId: 'c-2' }))).number).toBe('TSTS1/25-26/100002');
  });

  it('double tap: the same clientId in parallel gives one bill, one deduction, one queue entry', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    const input = sale({ memberCode: 'M123' });
    const [a, b] = await Promise.all([recordSale(input), recordSale(input)]);
    expect(b.number).toBe(a.number);
    expect(await db.bills.count()).toBe(1);
    expect(await db.movements.where('kind').equals('sale').count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.loyaltyQueue.count()).toBe(1);
    expect(await stock()).toBe(-5);
  });

  it('keeps the sequence across a reload and gives each counter its own series', async () => {
    const first = await recordSale(sale());
    db.close();
    await db.open();
    const second = await recordSale(sale({ clientId: 'c-2' }));
    expect(second.number).toBe('TSTS1/26-27/100002');
    expect(first.number).toBe('TSTS1/26-27/100001');

    const c2 = await recordSale(sale({ clientId: 'c-3', counter: 2 }));
    expect(c2.number).toBe('TSTS1-2/26-27/000001');
    const c2b = await recordSale(sale({ clientId: 'c-4', counter: 2 }));
    expect(c2b.number).toBe('TSTS1-2/26-27/000002');
    const other = await recordSale(sale({ clientId: 'c-5', storeCode: 'TSTS2' }));
    expect(other.number).toBe('TSTS2/26-27/100001');
  });

  it('never repeats a number when two clients record at once', async () => {
    const bills = await Promise.all([1, 2, 3, 4, 5].map((i) => recordSale(sale({ clientId: `p-${i}` }))));
    expect(new Set(bills.map((b) => b.number)).size).toBe(5);
  });

  it('practice bill: own number series, no stock, outbox or loyalty queue', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    const p1 = await recordSale(sale({ practice: true, memberCode: 'M123' }));
    expect(p1.number).toBe('TSTS1P/26-27/000001');
    expect(p1.status).toBe('practice');
    const p2 = await recordSale(sale({ practice: true, clientId: 'c-2', counter: 2 }));
    expect(p2.number).toBe('TSTS1P2/26-27/000001');
    expect(await db.movements.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.loyaltyQueue.count()).toBe(0);
    // the real series is untouched
    expect((await recordSale(sale({ clientId: 'c-3' }))).number).toBe('TSTS1/26-27/100001');
    expect((await db.counters.get(['TSTS1', 101]))?.next).toBe(2);
  });

  it('refuses a closed day, by IST date', async () => {
    await db.dayCloses.put({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST, totals: {} });
    await expect(recordSale(sale())).rejects.toBeInstanceOf(DayClosedError);
    expect(await db.bills.count()).toBe(0);
    await expect(recordSale(sale({ storeCode: 'TSTS2' }))).resolves.toBeTruthy();
  });

  it('closed-day check uses the IST day, not the UTC day', async () => {
    await db.dayCloses.put({ storeCode: 'TSTS1', date: '2026-04-01', lockedAt: NOON_IST, totals: {} });
    vi.setSystemTime(new Date('2026-03-31T18:30:00Z')); // 1 April in IST, still 31 March in UTC
    await expect(recordSale(sale())).rejects.toBeInstanceOf(DayClosedError);
    vi.setSystemTime(new Date('2026-03-31T18:29:00Z'));
    await expect(recordSale(sale({ clientId: 'c-2' }))).resolves.toBeTruthy();
  });

  it('rejects payments that do not add up to the net, writing nothing', async () => {
    await expect(recordSale(sale({ payments: [{ mode: 'cash', amount: 27400 }] }))).rejects.toThrow('payments_mismatch');
    expect(await db.bills.count()).toBe(0);
    expect(await db.counters.count()).toBe(0);
  });

  it('rejects an empty bill and a bad quantity', async () => {
    await expect(recordSale(sale({ lines: [], payments: [] }))).rejects.toThrow('empty_bill');
    await expect(recordSale(sale({ lines: [{ productId: 'P0090', qty: 0, mrp: 5500, discount: 0, tax: 0 }] }))).rejects.toThrow('bad_qty');
  });

  describe('loyalty queue', () => {
    it('queues rupees (floored) when loyalty is on and there is a member', async () => {
      await db.kv.put({ key: 'loyalty', value: true });
      const bill = await recordSale(
        sale({ memberCode: 'M123', lines: [{ productId: 'P0090', qty: 1, mrp: 5599, discount: 0, tax: 0 }], payments: [{ mode: 'upi', amount: 5599 }] }),
      );
      expect(await db.loyaltyQueue.toArray()).toMatchObject([{ memberCode: 'M123', billRupees: 55, billRef: bill.number, storeCode: 'TSTS1' }]);
    });
    it('queues nothing when loyalty is off, unknown, or there is no member', async () => {
      await recordSale(sale({ memberCode: 'M123' })); // never read
      await db.kv.put({ key: 'loyalty', value: false });
      await recordSale(sale({ clientId: 'c-2', memberCode: 'M123' }));
      await db.kv.put({ key: 'loyalty', value: true });
      await recordSale(sale({ clientId: 'c-3' }));
      expect(await db.loyaltyQueue.count()).toBe(0);
    });
  });
});

describe('voidBill', () => {
  it('restores stock, marks the bill void and is safe to repeat', async () => {
    const bill = await recordSale(sale());
    expect(await stock()).toBe(-5);
    await voidBill(bill.number, 'U2');
    expect(await stock()).toBe(0);
    expect((await db.bills.get(bill.number))?.status).toBe('void');
    expect(await db.movements.where('kind').equals('void').toArray()).toMatchObject([{ qty: 5, ref: bill.number, storeCode: 'TSTS1' }]);
    await voidBill(bill.number, 'U2');
    expect(await stock()).toBe(0);
    expect(await db.movements.count()).toBe(2);
  });
  it('queues a loyalty reversal only when the bill had a member', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    const withMember = await recordSale(sale({ memberCode: 'M123' }));
    const without = await recordSale(sale({ clientId: 'c-2' }));
    await voidBill(withMember.number, 'U2');
    await voidBill(without.number, 'U2');
    const queue = await db.loyaltyQueue.toArray();
    expect(queue.filter((q) => 'reverse' in q)).toMatchObject([{ reverse: withMember.number }]);
  });
  it('rejects an unknown bill', async () => {
    await expect(voidBill('NOPE', 'U2')).rejects.toThrow('bill_not_found');
  });
  it('leaves a practice bill alone', async () => {
    const p = await recordSale(sale({ practice: true }));
    await voidBill(p.number, 'U2');
    expect((await db.bills.get(p.number))?.status).toBe('practice');
    expect(await db.movements.count()).toBe(0);
  });
});

describe('outbox', () => {
  it('flush offline keeps everything pending; online marks it sent', async () => {
    await recordSale(sale());
    await recordSale(sale({ clientId: 'c-2' }));
    expect(await pendingCount()).toBe(2);
    await flushOutbox(false);
    expect(await pendingCount()).toBe(2);
    await flushOutbox(true);
    expect(await pendingCount()).toBe(0);
    await recordSale(sale({ clientId: 'c-3' }));
    expect(await pendingCount()).toBe(1);
  });
});
