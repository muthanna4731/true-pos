import { describe, expect, it } from 'vitest';
import { dayTotals, reportAsOf } from '../../src/domain/reports';
import { lineStatus } from '../../src/domain/stock';
import type { Bill, BillLine, Payment, PayMode, Product } from '../../src/domain/types';

const DAY = '2026-10-29';
const NOON_IST = '2026-10-29T06:30:00.000Z';

const product = (id: string, materialType: 'ALC' | 'NALC', category: Product['category'], subcategory: string): Product => ({
  id,
  materialType,
  category,
  subcategory,
  description: id,
  brand: id,
  shortName: id,
  sizeMl: 750,
  pack: 'BTL',
  caseSize: 12,
  hsn: '2203',
  taxRateBp: 0,
  barcode: id,
});
const WHISKY = product('W1', 'ALC', 'IML', 'WHISKY');
const BEER = product('B1', 'ALC', 'BEER', 'BEER');
const WATER = product('N1', 'NALC', 'NALC', 'WATER');
const products = new Map([WHISKY, BEER, WATER].map((p) => [p.id, p]));

let n = 0;
function bill(over: Partial<Bill> & { net: number; at?: string; mode?: PayMode; productId?: string; qty?: number }): {
  bill: Bill;
  line: BillLine;
  payment: Payment;
} {
  n += 1;
  const number = `TSTS1/26-27/${100000 + n}`;
  const { net, at = NOON_IST, mode = 'cash', productId = 'W1', qty = 1, ...rest } = over;
  return {
    bill: { number, clientId: `c${n}`, storeCode: 'TSTS1', counter: 1, cashierId: 'U1', shiftId: 'S1', at, gross: net, discount: 0, tax: 0, net, status: 'paid', ...rest },
    line: { billNumber: number, productId, qty, mrp: net / qty, discount: 0, tax: 0, amount: net },
    payment: { billNumber: number, mode, amount: net },
  };
}

function totalsOf(rows: ReturnType<typeof bill>[], storeCode = 'TSTS1', day = DAY) {
  return dayTotals(
    rows.map((r) => r.bill),
    rows.map((r) => r.line),
    rows.map((r) => r.payment),
    products,
    storeCode,
    day,
  );
}

describe('dayTotals', () => {
  const today = [
    bill({ net: 10000, mode: 'cash', productId: 'W1', qty: 2 }),
    bill({ net: 20000, mode: 'upi', productId: 'B1', qty: 4 }),
    bill({ net: 30000, mode: 'card', productId: 'N1', qty: 3 }),
  ];
  const noise = [
    bill({ net: 99900, status: 'void' }),
    bill({ net: 88800, status: 'practice' }),
    bill({ net: 77700, storeCode: 'TSTS2' }),
  ];

  it('counts only the paid bills of the day: practice and void are left out', () => {
    const t = totalsOf([...today, ...noise]);
    expect(t.net).toBe(60000);
    expect(t.bills).toBe(3);
    expect(t.avgBill).toBe(20000);
    expect(t.byMode).toEqual({ cash: 10000, upi: 20000, card: 30000 });
    expect(t.alc).toBe(30000);
    expect(t.nalc).toBe(30000);
    expect(t.byType).toEqual({ whisky: { qty: 2, amount: 10000 }, beer: { qty: 4, amount: 20000 }, other: { qty: 3, amount: 30000 } });
  });

  it('adds up discounts given and splits a mixed payment by mode', () => {
    const split = bill({ net: 9000 });
    split.bill.discount = 500;
    split.payment.amount = 4000;
    const second: Payment = { billNumber: split.bill.number, mode: 'upi', amount: 5000 };
    const t = dayTotals([split.bill], [split.line], [split.payment, second], products, 'TSTS1', DAY);
    expect(t.discount).toBe(500);
    expect(t.byMode).toEqual({ cash: 4000, upi: 5000, card: 0 });
  });

  it('is all zero (no divide by zero) on a day with no bills', () => {
    expect(totalsOf([], 'TSTS1', DAY)).toEqual({
      net: 0,
      bills: 0,
      avgBill: 0,
      byMode: { cash: 0, upi: 0, card: 0 },
      alc: 0,
      nalc: 0,
      byType: {},
      discount: 0,
      monthToDate: 0,
    });
  });

  it('sums month to date from the 1st of the IST month, up to the day', () => {
    const rows = [
      ...today,
      bill({ net: 50000, at: '2026-10-05T10:00:00.000Z' }),
      // 19:00 UTC on 30 Sep is 00:30 IST on 1 Oct: it belongs to October.
      bill({ net: 10000, at: '2026-09-30T19:00:00.000Z' }),
      // 18:00 UTC on 30 Sep is 23:30 IST on 30 Sep: September.
      bill({ net: 70000, at: '2026-09-30T18:00:00.000Z' }),
      // A later day is not in the month so far.
      bill({ net: 40000, at: '2026-10-30T06:30:00.000Z' }),
      bill({ net: 5000, at: '2026-10-10T06:30:00.000Z', status: 'void' }),
    ];
    const t = totalsOf(rows);
    expect(t.net).toBe(60000);
    expect(t.monthToDate).toBe(60000 + 50000 + 10000);
  });

  it('puts a bill just before midnight IST on the right day', () => {
    // 18:29 UTC on 29 Oct is 23:59 IST on 29 Oct; 18:30 UTC is already the 30th.
    const rows = [bill({ net: 100, at: '2026-10-29T18:29:00.000Z' }), bill({ net: 200, at: '2026-10-29T18:30:00.000Z' })];
    expect(totalsOf(rows).net).toBe(100);
    expect(totalsOf(rows, 'TSTS1', '2026-10-30').net).toBe(200);
  });
});

describe('reportAsOf', () => {
  it('stamps an open day with the time, in IST', () => {
    expect(reportAsOf(undefined, NOON_IST)).toEqual({ locked: false, label: 'as of 12:00 PM' });
    expect(reportAsOf(undefined, '2026-10-29T09:01:00.000Z').label).toBe('as of 2:31 PM');
  });
  it('says the figures are locked once the day is closed', () => {
    expect(reportAsOf({ lockedAt: NOON_IST }, '2026-10-29T09:01:00.000Z')).toEqual({ locked: true, label: 'Closed day: locked figures' });
  });
});

describe('lineStatus', () => {
  it('is match, short or extra', () => {
    expect(lineStatus(48, 48)).toBe('match');
    expect(lineStatus(48, 24)).toBe('short');
    expect(lineStatus(48, 50)).toBe('extra');
  });
});
