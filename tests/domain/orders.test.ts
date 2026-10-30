import { describe, expect, it } from 'vitest';
import { avgDailySales, grnTotals, INDENT_RE, KSBCL_INV_RE, minLevel, suggestedOrderCases, suggestOrder } from '../../src/domain/orders';
import type { Grn, Indent, Price, Product, StockMovement } from '../../src/domain/types';

describe('minLevel', () => {
  it('is three days of average sales, never below 6 bottles', () => {
    expect(minLevel(0)).toBe(6);
    expect(minLevel(1.5)).toBe(6);
    expect(minLevel(2)).toBe(6);
    expect(minLevel(2.1)).toBe(7);
    expect(minLevel(130)).toBe(390);
  });
});

describe('number formats', () => {
  it('accepts a KSBCL indent number and rejects an invoice number typed into it', () => {
    expect(INDENT_RE.test('INDMYH26009468')).toBe(true);
    expect(INDENT_RE.test('26008779.00')).toBe(false);
    expect(INDENT_RE.test('123')).toBe(false);
    expect(INDENT_RE.test('INDMYH26009468 ')).toBe(false);
  });

  it('accepts a KSBCL invoice number', () => {
    expect(KSBCL_INV_RE.test('SMYH26009086')).toBe(true);
    expect(KSBCL_INV_RE.test('INDMYH26009468')).toBe(false);
    expect(KSBCL_INV_RE.test('SMYH2600908')).toBe(false);
  });
});

describe('suggestedOrderCases', () => {
  it('orders whole cases for the days wanted, less stock and what is already on order', () => {
    // 7 x 20 = 140 wanted, 60 + 24 covered, 56 missing = 4.67 cases -> 5
    expect(suggestedOrderCases({ avgDaily: 20, minDays: 7, onHand: 60, onOrder: 24, caseSize: 12 })).toBe(5);
  });

  it('is 0 when stock covers the need', () => {
    expect(suggestedOrderCases({ avgDaily: 20, minDays: 7, onHand: 200, onOrder: 0, caseSize: 12 })).toBe(0);
    expect(suggestedOrderCases({ avgDaily: 20, minDays: 7, onHand: 100, onOrder: 40, caseSize: 12 })).toBe(0);
  });
});

const prod = (id: string, caseSize: number): Product =>
  ({ id, description: `${id} WHISKY 750 - BTL`, shortName: id, caseSize }) as Product;
const mv = (storeCode: string, productId: string, qty: number, kind: StockMovement['kind'], at: string): StockMovement => ({
  storeCode,
  productId,
  qty,
  kind,
  ref: 'x',
  at,
});

// 29 Oct 2026, 12:00 IST. The 7 days before today are 22 to 28 Oct.
const NOW = '2026-10-29T06:30:00.000Z';

describe('avgDailySales', () => {
  it('averages the sales of the 7 IST days before today, net of voids, ignoring today and older days', () => {
    const rows = [
      mv('S1', 'A', -14, 'sale', '2026-10-25T05:00:00.000Z'),
      mv('S1', 'A', 7, 'void', '2026-10-25T06:00:00.000Z'),
      mv('S1', 'A', -7, 'sale', '2026-10-28T18:40:00.000Z'), // 29 Oct 00:10 IST: today, left out
      mv('S1', 'A', -70, 'sale', '2026-10-21T18:31:00.000Z'), // 22 Oct 00:01 IST: the first minute of the window
      mv('S1', 'A', -99, 'sale', '2026-10-21T18:29:00.000Z'), // 21 Oct 23:59 IST: too old
    ];
    const avg = avgDailySales(rows, NOW);
    // 14 - 7 + 70 = 77 over 7 days
    expect(avg.get('S1|A')).toBe(11);
  });
});

describe('suggestOrder', () => {
  const products = [prod('A', 12), prod('B', 12)];
  const sold = [mv('S1', 'A', -140, 'sale', '2026-10-25T05:00:00.000Z'), mv('S2', 'A', -70, 'sale', '2026-10-25T05:00:00.000Z')];
  // Openings are sized so that, after the sales above, S1 holds 60 and S2 holds 10.
  const stock = [mv('S1', 'A', 200, 'opening', '2026-10-01T00:00:00.000Z'), mv('S2', 'A', 80, 'opening', '2026-10-01T00:00:00.000Z')];
  const onOrder: Indent = { id: 'INDMYH26000001', storeCode: 'S1', placedAt: NOW, status: 'placed', lines: [{ productId: 'A', cases: 2 }] };

  it('suggests for one shop: 7 days at 20 a day, 60 on the shelf, 24 on order -> 5 cases', () => {
    const lines = suggestOrder({ movements: [...sold, ...stock], products, indents: [onOrder], storeCodes: ['S1'], nowIso: NOW });
    expect(lines).toEqual([{ productId: 'A', cases: 5, onHand: 60, onOrder: 24, avgDaily: 20 }]);
  });

  it('leaves out draft and received orders, and products that do not sell', () => {
    const noise: Indent[] = [
      { ...onOrder, id: 'D1', status: 'draft' },
      { ...onOrder, id: 'D2', status: 'received' },
    ];
    const lines = suggestOrder({ movements: [...sold, ...stock], products, indents: noise, storeCodes: ['S1'], nowIso: NOW });
    expect(lines).toEqual([{ productId: 'A', cases: 7, onHand: 60, onOrder: 0, avgDaily: 20 }]);
  });

  it('for the hub view adds up the shops: 30 a day, 70 on the shelves -> 12 cases', () => {
    const lines = suggestOrder({ movements: [...sold, ...stock], products, indents: [], storeCodes: ['S1', 'S2'], nowIso: NOW });
    expect(lines[0]).toMatchObject({ productId: 'A', cases: 12, onHand: 70, avgDaily: 30 });
  });
});

describe('grnTotals', () => {
  it('adds AROED at the price in force on the day, and TCS, to the invoice', () => {
    const grn = {
      receivedAt: '2026-10-20T03:00:00.000Z',
      invoiceAmount: 100000,
      tcs: 2000,
      lines: [{ productId: 'A', expected: 10 }],
    } as unknown as Grn;
    const price = (effectiveFrom: string, aroed: number) => ({ productId: 'A', effectiveFrom, aroed }) as Price;
    expect(grnTotals(grn, [price('2026-04-01', 50), price('2026-10-20', 80), price('2026-10-21', 999)])).toEqual({ aroed: 800, total: 102800 });
    expect(grnTotals(grn, [])).toEqual({ aroed: 0, total: 102000 });
  });
});
