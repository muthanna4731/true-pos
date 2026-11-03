import { describe, expect, it } from 'vitest';
import { formatINRCompact } from '../../src/domain/money';
import {
  ageParts,
  brandSales,
  dailyUnits,
  hourSales,
  istHourStart,
  istWeekday,
  liveFeed,
  monthSales,
  offerImpact,
  purchasesSummary,
  rankProducts,
  runningOut,
  salesFigures,
  sheetRows,
  sparkPath,
  stockMoved,
  stockTotals,
  trendOf,
  weekdayDelta,
} from '../../src/domain/owner';
import { addIstDays } from '../../src/domain/time';
import type { Bill, BillLine, Grn, Product, StockMovement, Supplier, Transfer } from '../../src/domain/types';

// 29 Oct 2026 is a Thursday. IST day D runs from (D-1)T18:30Z to DT18:30Z.
const at = (day: string, hhmm: string): string => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

let seq = 0;
function bill(store: string, day: string, hhmm: string, net: number, over: Partial<Bill> = {}): Bill {
  seq += 1;
  return {
    number: `${store}/26-27/${String(seq).padStart(6, '0')}`,
    clientId: `c${seq}`,
    storeCode: store,
    counter: 1,
    cashierId: 'U',
    shiftId: 'S',
    at: at(day, hhmm),
    gross: net,
    discount: 0,
    tax: 0,
    net,
    status: 'paid',
    ...over,
  };
}
const line = (b: Bill, productId: string, qty: number, amount: number): BillLine => ({ billNumber: b.number, productId, qty, mrp: Math.round(amount / qty), discount: 0, tax: 0, amount });

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  materialType: 'ALC',
  category: 'IML',
  subcategory: 'WHISKY',
  description: `${id} 750ml`,
  brand: id,
  shortName: id,
  sizeMl: 750,
  pack: 'BTL',
  caseSize: 12,
  hsn: '2208',
  taxRateBp: 0,
  barcode: '',
  ...over,
});
const products = new Map<string, Product>([
  ['OM', product('OM')],
  ['KF', product('KF', { category: 'BEER', brand: 'KF', pack: 'CAN', caseSize: 24 })],
  ['SODA', product('SODA', { materialType: 'NALC', category: 'NALC', brand: 'SODA' })],
]);

describe('istWeekday and addIstDays', () => {
  it('names the weekday of an IST day (0 = Sunday)', () => {
    expect(istWeekday('2026-11-02')).toBe(1);
    expect(istWeekday('2026-10-29')).toBe(4);
    expect(istWeekday('2026-11-01')).toBe(0);
  });
  it('adds days across a month end', () => {
    expect(addIstDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addIstDays('2026-11-02', -7)).toBe('2026-10-26');
  });
});

describe('salesFigures', () => {
  const b1 = bill('TSTS1', '2026-10-29', '10:00', 100000, { discount: 5000 });
  const b2 = bill('TSTS2', '2026-10-29', '11:00', 50000);
  const edgeIn = bill('TSTS1', '2026-10-29', '00:00', 20000); // first instant of the IST day
  const edgeOut = { ...bill('TSTS1', '2026-10-30', '00:00', 99999), at: '2026-10-29T18:30:00.000Z' }; // first instant of the next day
  const lateNight = { ...bill('TSTS1', '2026-10-29', '23:59', 7000), at: '2026-10-29T18:29:59.999Z' };
  const practice = bill('TSTS1', '2026-10-29', '12:00', 88888, { status: 'practice' });
  const voided = bill('TSTS1', '2026-10-29', '12:30', 77777, { status: 'void' });
  const bills = [b1, b2, edgeIn, edgeOut, lateNight, practice, voided];
  const lines = [line(b1, 'OM', 2, 70000), line(b1, 'SODA', 3, 30000), line(b2, 'KF', 5, 50000), line(edgeIn, 'OM', 1, 20000), line(lateNight, 'SODA', 1, 7000), line(practice, 'OM', 1, 88888)];

  it('adds paid bills of the IST day, all shops, leaving out practice, void and other days', () => {
    const f = salesFigures(bills, lines, products, '2026-10-29', null);
    expect(f.net).toBe(100000 + 50000 + 20000 + 7000);
    expect(f.bills).toBe(4);
    expect(f.avgBill).toBe(Math.round(177000 / 4));
    expect(f.discount).toBe(5000);
  });
  it('splits alcoholic and other by line amounts, and they add up to the net', () => {
    const f = salesFigures(bills, lines, products, '2026-10-29', null);
    expect(f.alc).toBe(70000 + 50000 + 20000);
    expect(f.nalc).toBe(30000 + 7000);
    expect(f.alc + f.nalc).toBe(f.net);
  });
  it('gives the discount as tenths of a percent of sales', () => {
    expect(salesFigures(bills, lines, products, '2026-10-29', 'TSTS1').discountTenthPct).toBe(Math.round((5000 * 1000) / 127000));
  });
  it('one shop sees only its own bills', () => {
    const f = salesFigures(bills, lines, products, '2026-10-29', 'TSTS2');
    expect(f.net).toBe(50000);
    expect(f.bills).toBe(1);
  });
  it('is all zeros, not NaN, on a day with no bills', () => {
    expect(salesFigures(bills, lines, products, '2026-10-20', null)).toEqual({ net: 0, bills: 0, avgBill: 0, discount: 0, discountTenthPct: 0, alc: 0, nalc: 0 });
  });
});

describe('weekdayDelta', () => {
  // Thursday 29 Oct against Thursday 22 Oct.
  const bills = [
    bill('TSTS1', '2026-10-29', '10:00', 112000),
    bill('TSTS1', '2026-10-22', '10:00', 100000),
    bill('TSTS1', '2026-10-28', '10:00', 999999), // a Wednesday: not the comparison day
    bill('TSTS2', '2026-10-22', '10:00', 50000),
    bill('TSTS1', '2026-10-22', '11:00', 77777, { status: 'practice' }),
  ];
  it('compares with the same weekday a week earlier, in whole percent', () => {
    const d = weekdayDelta(bills, '2026-10-29', 'TSTS1');
    expect(d).toEqual({ current: 112000, previous: 100000, pct: 12, weekday: 4 });
  });
  it('covers every shop when the scope is all', () => {
    expect(weekdayDelta(bills, '2026-10-29', null)).toMatchObject({ current: 112000, previous: 150000, pct: -25 });
  });
  it('has no percentage when last week had no sales', () => {
    expect(weekdayDelta(bills, '2026-10-29', 'TSTS3')).toMatchObject({ previous: 0, pct: null });
    expect(weekdayDelta(bills, '2026-10-30', null).pct).toBeNull();
  });
  it('compares by IST day, not UTC day', () => {
    const edge = [{ ...bill('TSTS1', '2026-10-22', '00:10', 40000), at: '2026-10-21T18:40:00.000Z' }, bill('TSTS1', '2026-10-29', '00:05', 80000)];
    expect(weekdayDelta(edge, '2026-10-29', null)).toMatchObject({ previous: 40000, current: 80000, pct: 100 });
  });
});

describe('weekdayDelta, today so far', () => {
  // Thursday 29 Oct, 12:00 IST: last Thursday counts only up to 12:00 IST.
  const bills = [
    bill('TSTS1', '2026-10-29', '09:00', 60000),
    bill('TSTS1', '2026-10-22', '09:00', 50000),
    bill('TSTS1', '2026-10-22', '11:59', 50000),
    bill('TSTS1', '2026-10-22', '12:00', 400000), // at the cut-off: not yet sold at this time of day
    bill('TSTS1', '2026-10-22', '18:00', 400000), // later that day
  ];
  it('cuts last week off at the same IST time of day while the day is today', () => {
    expect(weekdayDelta(bills, '2026-10-29', null, at('2026-10-29', '12:00'))).toMatchObject({ current: 60000, previous: 100000, pct: -40 });
  });
  it('one minute before the cut-off leaves out the 11:59 bill', () => {
    expect(weekdayDelta(bills, '2026-10-29', null, at('2026-10-29', '11:58'))).toMatchObject({ previous: 50000, pct: 20 });
  });
  it('cuts at IST midnight, not UTC midnight', () => {
    const edge = [
      { ...bill('TSTS1', '2026-10-22', '00:10', 40000), at: '2026-10-21T18:40:00.000Z' }, // 00:10 IST
      bill('TSTS1', '2026-10-22', '00:40', 90000),
      bill('TSTS1', '2026-10-29', '00:05', 80000),
    ];
    expect(weekdayDelta(edge, '2026-10-29', null, at('2026-10-29', '00:30'))).toMatchObject({ previous: 40000, current: 80000, pct: 100 });
  });
  it('keeps the whole day for a past day, even with a clock given', () => {
    expect(weekdayDelta(bills, '2026-10-29', null, at('2026-10-30', '12:00'))).toMatchObject({ previous: 900000 });
  });
});

describe('hourSales', () => {
  // 29 Oct 2026, 12:45 IST.
  const now = at('2026-10-29', '12:45');
  const bills = [
    bill('TSTS1', '2026-10-29', '12:00', 1000), // exactly the top of the hour
    bill('TSTS1', '2026-10-29', '12:40', 2000),
    { ...bill('TSTS1', '2026-10-29', '11:59', 4000), at: '2026-10-29T06:29:59.999Z' }, // one ms before 12:00 IST
    bill('TSTS2', '2026-10-29', '12:10', 8000),
    bill('TSTS2', '2026-10-29', '12:20', 16000, { status: 'void' }),
    bill('TSTS2', '2026-10-29', '12:21', 32000, { status: 'practice' }),
    bill('TSTS2', '2026-10-29', '13:05', 64000), // an hour that has not started
  ];
  it('starts the hour on the IST hour, which is half past in UTC', () => {
    expect(istHourStart(now)).toBe(at('2026-10-29', '12:00'));
    expect(istHourStart(at('2026-10-29', '00:00'))).toBe(at('2026-10-29', '00:00'));
  });
  it('adds paid bills since the top of the hour', () => {
    expect(hourSales(bills, now, null)).toEqual({ net: 11000, bills: 3, sinceIso: at('2026-10-29', '12:00') });
  });
  it('limits to one shop', () => {
    expect(hourSales(bills, now, 'TSTS2')).toMatchObject({ net: 8000, bills: 1 });
  });
});

describe('top products and their week', () => {
  const day = '2026-10-29';
  const sale = (d: string, store: string, pid: string, qty: number, amount: number, status: Bill['status'] = 'paid') => {
    const b = bill(store, d, '10:00', amount, { status });
    return { b, l: line(b, pid, qty, amount) };
  };
  const rows = [
    sale(day, 'TSTS1', 'OM', 10, 50000),
    sale(day, 'TSTS2', 'OM', 5, 25000),
    sale(day, 'TSTS1', 'KF', 40, 60000),
    sale(day, 'TSTS1', 'SODA', 4, 2000),
    sale(day, 'TSTS1', 'OM', 100, 999999, 'practice'),
    sale('2026-10-28', 'TSTS1', 'OM', 3, 15000),
    sale('2026-10-26', 'TSTS1', 'OM', 9, 45000),
    sale('2026-10-22', 'TSTS1', 'OM', 99, 495000), // before the 7-day window
  ];
  const bills = rows.map((r) => r.b);
  const lines = rows.map((r) => r.l);

  it('ranks by amount for the day, with units, practice bills left out', () => {
    expect(rankProducts(bills, lines, day, null, 2)).toEqual([
      { productId: 'KF', units: 40, amount: 60000 },
      { productId: 'OM', units: 15, amount: 75000 },
    ].sort((a, b) => b.amount - a.amount));
  });
  it('one shop ranks only its own sales', () => {
    expect(rankProducts(bills, lines, day, 'TSTS2')).toEqual([{ productId: 'OM', units: 5, amount: 25000 }]);
  });
  it('breaks ties by product id so the order is stable', () => {
    const a = sale(day, 'TSTS1', 'KF', 1, 100);
    const b = sale(day, 'TSTS1', 'OM', 1, 100);
    expect(rankProducts([b.b, a.b], [b.l, a.l], day, null).map((r) => r.productId)).toEqual(['KF', 'OM']);
  });
  it('gives 7 daily unit counts, oldest first, ending on the day', () => {
    expect(dailyUnits(bills, lines, 'OM', day, null)).toEqual([0, 0, 0, 9, 0, 3, 15]);
    expect(dailyUnits(bills, lines, 'OM', day, 'TSTS2')).toEqual([0, 0, 0, 0, 0, 0, 5]);
  });
  it('reads a trend from the first three days against the last three', () => {
    expect(trendOf([1, 1, 2, 3, 5, 6, 8])).toBe('up');
    expect(trendOf([8, 7, 6, 5, 3, 2, 1])).toBe('down');
    expect(trendOf([5, 6, 5, 5, 6, 5, 5])).toBe('flat');
    expect(trendOf([0, 0, 0, 0, 0, 0, 0])).toBe('flat');
    expect(trendOf([0, 0, 0, 0, 0, 0, 4])).toBe('up');
  });
  it('draws a sparkline path inside its box, and a flat line for an all-equal week', () => {
    const p = sparkPath([0, 5, 10], 44, 18);
    expect(p).toBe('M0 16 L22 9 L44 2');
    expect(sparkPath([3, 3, 3], 44, 18)).toBe('M0 9 L22 9 L44 9');
    expect(sparkPath([], 44, 18)).toBe('');
  });
});

describe('runningOut', () => {
  const NOW = at('2026-10-29', '12:00');
  const mv = (store: string, productId: string, qty: number, kind: StockMovement['kind'], day: string, hhmm = '10:00'): StockMovement => ({ storeCode: store, productId, qty, kind, ref: 'r', at: at(day, hhmm) });
  // OM at TS1: sells 14 a day over the last 7 days (reorder level 42), on hand 0. KF at TS1 sells 7 a day (level 21), on hand 9.
  // SODA at TS1 never sells. OM at TS2 sells 7 a day, on hand 500.
  const week = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'];
  const movements: StockMovement[] = [
    mv('TSTS1', 'OM', 1000, 'opening', '2026-10-01'),
    mv('TSTS1', 'KF', 1000, 'opening', '2026-10-01'),
    mv('TSTS1', 'SODA', 0, 'opening', '2026-10-01'),
    mv('TSTS2', 'OM', 1000, 'opening', '2026-10-01'),
    ...week.flatMap((d) => [mv('TSTS1', 'OM', -14, 'sale', d), mv('TSTS1', 'KF', -7, 'sale', d), mv('TSTS2', 'OM', -7, 'sale', d)]),
  ];
  // Bring OM at TS1 to 0 and KF at TS1 to 9, and sell some today.
  movements.push(mv('TSTS1', 'OM', -(1000 - 98), 'loss', '2026-10-28', '20:00'));
  movements.push(mv('TSTS1', 'KF', -(1000 - 49 - 9), 'loss', '2026-10-28', '20:00'));
  movements.push(mv('TSTS1', 'OM', -3, 'sale', '2026-10-29'), mv('TSTS1', 'OM', 1, 'void', '2026-10-29'), mv('TSTS1', 'OM', 2, 'purchase', '2026-10-29'));

  it('lists the low and out products by the same rule as the office to-do list', () => {
    const rows = runningOut(movements, NOW, '2026-10-29', null);
    expect(rows.map((r) => `${r.storeCode}:${r.productId}:${r.onHand}:${r.level}`)).toEqual(['TSTS1:OM:0:out', 'TSTS1:KF:9:low']);
  });
  it('counts what sold on the day, net of voids, per shop and product', () => {
    expect(runningOut(movements, NOW, '2026-10-29', null)[0].soldOnDay).toBe(2);
    expect(runningOut(movements, NOW, '2026-10-28', null)[0].soldOnDay).toBe(14);
  });
  it('one shop sees only its own rows, and a shop with enough stock sees none', () => {
    expect(runningOut(movements, NOW, '2026-10-29', 'TSTS1')).toHaveLength(2);
    expect(runningOut(movements, NOW, '2026-10-29', 'TSTS2')).toEqual([]);
  });
});

describe('stockTotals and the daily sheet', () => {
  const mv = (store: string, productId: string, qty: number, kind: StockMovement['kind'], day: string, hhmm = '10:00'): StockMovement => ({ storeCode: store, productId, qty, kind, ref: 'r', at: at(day, hhmm) });
  const movements: StockMovement[] = [
    mv('TSTS1', 'OM', 100, 'opening', '2026-10-01'),
    mv('TSTS1', 'OM', 48, 'purchase', '2026-10-29'),
    mv('TSTS1', 'OM', -30, 'sale', '2026-10-29'),
    mv('TSTS1', 'OM', -20, 'sale', '2026-10-30'), // after the day: not counted
    mv('TSTS2', 'OM', 10, 'opening', '2026-10-01'),
    mv('TSTS2', 'OM', -4, 'transfer_out', '2026-10-29'),
    mv('TSTS1', 'KF', 0, 'opening', '2026-10-01'),
    mv('TSTS1', 'SODA', 20, 'opening', '2026-10-01'),
    mv('TSTS1', 'SODA', -20, 'sale', '2026-10-29'),
  ];
  const landed = (id: string) => (id === 'OM' ? 40000 : 10000);
  const mrp = (id: string) => (id === 'OM' ? 50000 : 13000);

  it('values closing stock at landed cost and counts the products in stock', () => {
    expect(stockTotals(movements, landed, '2026-10-29', null)).toEqual({ value: (118 + 6) * 40000, items: 1 });
    expect(stockTotals(movements, landed, '2026-10-29', 'TSTS2')).toEqual({ value: 6 * 40000, items: 1 });
  });
  it('shows open, in, out and closing for the day, chain-wide or per shop', () => {
    const all = sheetRows(movements, products, mrp, '2026-10-29', null, 'all');
    const om = all.find((r) => r.productId === 'OM')!;
    expect(om).toMatchObject({ opening: 110, in: 48, out: 34, closing: 124, mrp: 50000 });
    const ts2 = sheetRows(movements, products, mrp, '2026-10-29', 'TSTS2', 'all');
    expect(ts2.find((r) => r.productId === 'OM')).toMatchObject({ opening: 10, in: 0, out: 4, closing: 6 });
  });
  it('filters alcoholic and other, and leaves out products with nothing to show', () => {
    expect(sheetRows(movements, products, mrp, '2026-10-29', null, 'alc').map((r) => r.productId)).toEqual(['OM']);
    expect(sheetRows(movements, products, mrp, '2026-10-29', null, 'other').map((r) => r.productId)).toEqual(['SODA']);
    expect(sheetRows(movements, products, mrp, '2026-10-29', null, 'all').map((r) => r.productId)).not.toContain('KF');
  });
  it('sorts the busiest first', () => {
    expect(sheetRows(movements, products, mrp, '2026-10-29', null, 'all').map((r) => r.productId)).toEqual(['OM', 'SODA']);
  });
});

describe('liveFeed', () => {
  const bills = [
    bill('TSTS1', '2026-10-29', '10:00', 100),
    bill('TSTS2', '2026-10-29', '10:05', 200),
    bill('TSTS1', '2026-10-29', '10:10', 300),
    bill('TSTS1', '2026-10-29', '10:15', 400, { status: 'void' }),
    bill('TSTS1', '2026-10-29', '10:20', 500, { status: 'practice' }),
  ];
  const items = new Map(bills.map((b, i) => [b.number, i + 1]));
  it('lists paid bills newest first with their item counts', () => {
    const feed = liveFeed(bills, items, null);
    expect(feed.map((f) => f.net)).toEqual([300, 200, 100]);
    expect(feed[0]).toMatchObject({ number: bills[2].number, items: 3, counter: 1, storeCode: 'TSTS1', at: bills[2].at });
  });
  it('stops at the limit and limits to one shop', () => {
    expect(liveFeed(bills, items, null, 2)).toHaveLength(2);
    expect(liveFeed(bills, items, 'TSTS2').map((f) => f.net)).toEqual([200]);
  });
});

describe('stockMoved', () => {
  const mv = (store: string, kind: StockMovement['kind'], qty: number, ref: string, day: string): StockMovement => ({ storeCode: store, productId: 'OM', qty, kind, ref, at: at(day, '10:00') });
  const movements: StockMovement[] = [
    mv('TSTS1', 'purchase', 100, 'G1', '2026-10-29'),
    mv('TSTS1', 'purchase', 48, 'G1', '2026-10-29'),
    mv('TSTS1', 'purchase', 12, 'G2', '2026-10-29'),
    mv('TSTS1', 'purchase', 6, 'G3', '2026-10-29'), // a non-KSBCL delivery
    mv('TSTS1', 'purchase', 999, 'G9', '2026-10-28'),
    mv('TSTS1', 'transfer_out', -24, 'T1', '2026-10-29'),
    mv('TSTS2', 'transfer_in', 24, 'T1', '2026-10-29'),
    mv('TSTS2', 'transfer_out', -5, 'T2', '2026-10-29'),
    mv('TSTS1', 'sale', -3, 'B1', '2026-10-29'),
  ];
  const type = (ref: string) => (ref === 'G3' ? 'other' : ref.startsWith('G') ? 'ksbcl' : undefined);
  it('adds KSBCL receipts, other receipts and transfers for the day, counting each GRN or transfer once', () => {
    expect(stockMoved(movements, type, '2026-10-29', null)).toEqual({
      ksbcl: { qty: 160, count: 2 },
      other: { qty: 6, count: 1 },
      transferOut: { qty: 29, count: 2 },
      transferIn: { qty: 24, count: 1 },
    });
  });
  it('one shop sees only its side of a transfer', () => {
    expect(stockMoved(movements, type, '2026-10-29', 'TSTS2')).toEqual({
      ksbcl: { qty: 0, count: 0 },
      other: { qty: 0, count: 0 },
      transferOut: { qty: 5, count: 1 },
      transferIn: { qty: 24, count: 1 },
    });
  });
});

describe('purchasesSummary', () => {
  const grn = (id: string, store: string, type: Grn['type'], supplierId: string, day: string, amount: number, lines: Grn['lines'], status: Grn['status'] = 'received'): Grn => ({
    id,
    storeCode: store,
    type,
    status,
    supplierId,
    invoiceNo: `INV-${id}`,
    receivedAt: at(day, '11:00'),
    invoiceAmount: amount,
    tcs: 0,
    lines,
  });
  const l = (productId: string, expected: number, counted?: number): Grn['lines'][number] => ({ productId, expected, ...(counted !== undefined ? { counted } : {}), unitPrice: 1 });
  const grns: Grn[] = [
    grn('G1', 'TSTS1', 'ksbcl', 'SUP-K', '2026-10-10', 2160000, [l('OM', 48)]),
    grn('G2', 'TSTS1', 'ksbcl', 'SUP-K', '2026-10-12', 1000000, [l('OM', 24), l('KF', 48)]),
    grn('G3', 'TSTS2', 'ksbcl', 'SUP-K', '2026-10-14', 500000, [l('KF', 24, 20)]),
    grn('G4', 'TSTS1', 'other', 'SUP-L', '2026-10-15', 300000, [l('SODA', 48)]),
    grn('G5', 'TSTS1', 'ksbcl', 'SUP-K', '2026-09-30', 7777777, [l('OM', 12)]), // last month
    grn('G6', 'TSTS1', 'ksbcl', 'SUP-K', '2026-10-16', 6666666, [l('OM', 12)], 'draft'),
  ];
  const suppliers: Supplier[] = [
    { id: 'SUP-K', name: 'KSBCL', kind: 'ksbcl' },
    { id: 'SUP-L', name: 'Local', kind: 'other' },
  ];
  const tr = (id: string, from: string, to: string, qty: number, day: string, status: Transfer['status'] = 'received'): Transfer => ({
    id,
    fromStore: from,
    toStore: to,
    lines: [{ productId: 'OM', qty }],
    permitNo: 'P',
    status,
    dispatchedAt: at(day, '09:00'),
    ...(status === 'received' ? { receivedAt: at(day, '15:00') } : {}),
  });
  const transfers: Transfer[] = [tr('T1', 'TSTS1', 'TSTS2', 24, '2026-10-11'), tr('T2', 'TSTS2', 'TSTS1', 12, '2026-10-13'), tr('T3', 'TSTS1', 'TSTS3', 6, '2026-10-20', 'in_transit'), tr('T4', 'TSTS1', 'TSTS2', 5, '2026-09-29')];
  const run = (scope: string | null) => purchasesSummary({ grns, transfers, products, suppliers, scope, month: '2026-10' });

  it('totals KSBCL and other vendors for the month, received deliveries only', () => {
    const s = run(null);
    expect(s.ksbcl).toBe(2160000 + 1000000 + 500000);
    expect(s.other).toBe(300000);
    expect(s.entries).toBe(4);
  });
  it('lists receipts newest first with cases, naming the product when there is one', () => {
    const s = run(null);
    expect(s.receipts.map((r) => r.id)).toEqual(['G4', 'G3', 'G2', 'G1']);
    expect(s.receipts.find((r) => r.id === 'G1')).toMatchObject({ cases: 4, productId: 'OM', alcohol: true, amount: 2160000, invoiceNo: 'INV-G1' });
    expect(s.receipts.find((r) => r.id === 'G2')).toMatchObject({ cases: 4, productId: null, alcohol: true }); // 24/12 + 48/24, mixed
    expect(s.receipts.find((r) => r.id === 'G3')).toMatchObject({ cases: Math.round((20 / 24) * 10) / 10 }); // counted, not invoiced
    expect(s.receipts.find((r) => r.id === 'G4')).toMatchObject({ alcohol: false });
  });
  it('ranks suppliers by amount with their receipt counts', () => {
    expect(run(null).suppliers).toEqual([
      { supplierId: 'SUP-K', name: 'KSBCL', receipts: 3, amount: 3660000 },
      { supplierId: 'SUP-L', name: 'Local', receipts: 1, amount: 300000 },
    ]);
  });
  it('shows transfers as out (-) or in (+) for one shop, and as between shops for all', () => {
    const all = run(null).transfers;
    expect(all.map((t) => `${t.id}:${t.direction}:${t.qty}`)).toEqual(['T3:between:6', 'T2:between:12', 'T1:between:24']);
    const ts1 = run('TSTS1').transfers;
    expect(ts1.map((t) => `${t.id}:${t.direction}:${t.qty}`)).toEqual(['T3:out:6', 'T2:in:12', 'T1:out:24']);
  });
  it('one shop sees only its own deliveries', () => {
    const s = run('TSTS2');
    expect(s.entries).toBe(1);
    expect(s.ksbcl).toBe(500000);
    expect(s.transfers.map((t) => t.id)).toEqual(['T2', 'T1']);
  });
});

describe('monthSales, brandSales and offerImpact', () => {
  const b1 = bill('TSTS1', '2026-10-05', '10:00', 100000, { discount: 4000 });
  const b2 = bill('TSTS2', '2026-10-20', '10:00', 50000, { discount: 1000 });
  const b3 = bill('TSTS1', '2026-10-30', '10:00', 70000); // after the day
  const b4 = bill('TSTS1', '2026-09-30', '10:00', 70000); // last month
  const b5 = bill('TSTS1', '2026-10-06', '10:00', 70000, { status: 'void' });
  const bills = [b1, b2, b3, b4, b5];
  const lines = [line(b1, 'OM', 4, 70000), line(b1, 'KF', 6, 30000), line(b2, 'OM', 1, 50000), line(b3, 'OM', 9, 70000), line(b5, 'OM', 9, 70000)];

  it('adds the month so far: store total, bills and discount', () => {
    expect(monthSales(bills, null, '2026-10-29')).toEqual({ net: 150000, bills: 2, discount: 5000 });
    expect(monthSales(bills, 'TSTS1', '2026-10-29')).toEqual({ net: 100000, bills: 1, discount: 4000 });
  });
  it('ranks brands by amount with units, in the range, paid bills only', () => {
    expect(brandSales(bills, lines, products, null, '2026-10-01', '2026-10-29')).toEqual([
      { brand: 'OM', units: 5, amount: 120000 },
      { brand: 'KF', units: 6, amount: 30000 },
    ]);
    expect(brandSales(bills, lines, products, 'TSTS2', '2026-10-01', '2026-10-29')).toEqual([{ brand: 'OM', units: 1, amount: 50000 }]);
  });
  it('adds the bills and discount each offer gave', () => {
    const impact = offerImpact([
      { brand: 'OM', offerType: 'store', product: 'x', offerCode: 'OFF1', billNumber: 'B1', qty: 2, freeQty: 0, amount: 1, discount: 2000 },
      { brand: 'OM', offerType: 'store', product: 'x', offerCode: 'OFF1', billNumber: 'B1', qty: 1, freeQty: 0, amount: 1, discount: 500 },
      { brand: 'OM', offerType: 'store', product: 'x', offerCode: 'OFF1', billNumber: 'B2', qty: 1, freeQty: 0, amount: 1, discount: 1000 },
      { brand: 'KF', offerType: 'brand', product: 'y', offerCode: 'OFF2', billNumber: 'B3', qty: 1, freeQty: 0, amount: 1, discount: 300 },
    ]);
    expect(impact.get('OFF1')).toEqual({ bills: 2, discount: 3500 });
    expect(impact.get('OFF2')).toEqual({ bills: 1, discount: 300 });
  });
});

describe('ageParts and formatINRCompact', () => {
  it('counts seconds, then minutes, hours and days since the newest bill', () => {
    expect(ageParts(12_400)).toEqual({ n: 12, unit: 's' });
    expect(ageParts(59_999)).toEqual({ n: 59, unit: 's' });
    expect(ageParts(60_000)).toEqual({ n: 1, unit: 'm' });
    expect(ageParts(3_600_000 * 5 + 1)).toEqual({ n: 5, unit: 'h' });
    expect(ageParts(86_400_000 * 3)).toEqual({ n: 3, unit: 'd' });
    expect(ageParts(-5000)).toEqual({ n: 0, unit: 's' });
  });
  it('shortens money for a narrow strip: thousands, lakhs and crores', () => {
    expect(formatINRCompact(0)).toBe('₹0');
    expect(formatINRCompact(99900)).toBe('₹999');
    expect(formatINRCompact(4210000)).toBe('₹42.1k');
    expect(formatINRCompact(184000000)).toBe('₹18.4L');
    expect(formatINRCompact(1960000000)).toBe('₹1.96Cr');
    expect(formatINRCompact(-4210000)).toBe('-₹42.1k');
  });
});
