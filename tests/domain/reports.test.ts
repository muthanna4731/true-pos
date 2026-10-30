import { describe, expect, it } from 'vitest';
import {
  dailyLitreStatement,
  discountsReport,
  exciseLitreStatement,
  lossesReport,
  remittance,
  valuation,
} from '../../src/domain/reports';
import type { Bill, BillLine, Loss, MovementKind, Offer, Product, StockMovement } from '../../src/domain/types';

const product = (id: string, over: Partial<Product>): Product => ({
  id,
  materialType: 'ALC',
  category: 'IML',
  subcategory: 'WHISKY',
  description: id,
  brand: id,
  shortName: id,
  sizeMl: 750,
  pack: 'BTL',
  caseSize: 12,
  hsn: '2208',
  taxRateBp: 0,
  barcode: id,
  ...over,
});
const BEER = product('BEER500', { category: 'BEER', subcategory: 'BEER', sizeMl: 500, pack: 'CAN' });
const WHISKY90 = product('W90', { sizeMl: 90, pack: 'TPACK' });
const WINE = product('WINE', { category: 'WINE', subcategory: 'WINE' });
const WATER = product('WATER', { materialType: 'NALC', category: 'NALC', subcategory: 'WATER', sizeMl: 1000 });
const products = [BEER, WHISKY90, WINE, WATER];

const mv = (productId: string, qty: number, kind: MovementKind, at: string): StockMovement => ({
  storeCode: 'TSTS1',
  productId,
  qty,
  kind,
  ref: kind,
  at,
});
const D1 = '2026-08-10T04:00:00Z';
const D2 = '2026-08-11T04:00:00Z';
const D3 = '2026-08-12T04:00:00Z';

const costs: Record<string, number> = { BEER500: 17727, W90: 4000, WINE: 50000, WATER: 1000 };
const costOf = (id: string) => costs[id] ?? 0;
const mrps: Record<string, number> = { BEER500: 20000, W90: 5000, WINE: 60000, WATER: 2000 };
const mrpOf = (id: string) => mrps[id] ?? 0;

describe('exciseLitreStatement', () => {
  it('values a negative beer can balance at landed cost: -3 cans of 500 ml', () => {
    const rows = exciseLitreStatement([mv('BEER500', -3, 'sale', D1)], products, costOf, 'TSTS1', '2026-08-10', '2026-08-10');
    const row = rows.find((r) => r.productId === 'BEER500')!;
    expect(row.group).toBe('BEER');
    expect(row.closing).toEqual({ qty: -3, litres: -1.5, amount: -53181 });
    expect(row.issued).toEqual({ qty: 3, litres: 1.5, amount: 53181 });
  });

  it('puts wine in the IML group and leaves non-alcoholic products out', () => {
    const rows = exciseLitreStatement(
      [mv('WINE', 6, 'purchase', D1), mv('WATER', 10, 'purchase', D1)],
      products,
      costOf,
      'TSTS1',
      '2026-08-10',
      '2026-08-10',
    );
    expect(rows.map((r) => [r.productId, r.group])).toEqual([['WINE', 'IML']]);
  });

  it('gives 16.11 litres for 179 bottles of 90 ml', () => {
    const rows = exciseLitreStatement([mv('W90', 179, 'purchase', D1)], products, costOf, 'TSTS1', '2026-08-10', '2026-08-10');
    expect(rows[0]!.received.litres).toBe(16.11);
    expect(rows[0]!.closing.litres).toBe(16.11);
  });

  it('splits opening, received, issued and closing over a range', () => {
    const ms = [
      mv('W90', 100, 'opening', D1),
      mv('W90', 50, 'purchase', D2),
      mv('W90', -20, 'sale', D2),
      mv('W90', 2, 'void', D2),
      mv('W90', -5, 'transfer_out', D3),
      mv('W90', 7, 'purchase', '2026-08-13T04:00:00Z'), // after the range
    ];
    const [row] = exciseLitreStatement(ms, products, costOf, 'TSTS1', '2026-08-11', '2026-08-12');
    expect(row!.opening.qty).toBe(100);
    expect(row!.received.qty).toBe(52); // positive movements: purchase + void
    expect(row!.issued.qty).toBe(25); // absolute negatives: sale + transfer out
    expect(row!.closing.qty).toBe(127);
    expect(row!.opening.amount).toBe(100 * 4000);
  });
});

describe('dailyLitreStatement', () => {
  const ms = [
    mv('BEER500', 48, 'opening', D1),
    mv('W90', 100, 'opening', D1),
    mv('WINE', 12, 'opening', D1),
    mv('BEER500', 24, 'purchase', D2),
    mv('W90', 96, 'purchase', D2),
    mv('W90', -33, 'sale', D2),
    mv('BEER500', -7, 'sale', D2),
    mv('WATER', 99, 'opening', D1),
  ];

  it('has a BEER, an IML (wine inside) and a Grand Total line in litres', () => {
    const rows = dailyLitreStatement(ms, products, 'TSTS1', '2026-08-11');
    expect(rows.map((r) => r.group)).toEqual(['BEER', 'IML', 'Grand Total']);
    const iml = rows[1]!;
    expect(iml.opening).toBe(100 * 0.09 + 12 * 0.75); // 9 + 9
    expect(iml.purchase).toBe(8.64);
    expect(iml.sales).toBe(2.97);
    expect(iml.closing).toBe(23.67);
  });

  it('adds BEER and IML into the Grand Total on every column', () => {
    const [beer, iml, grand] = dailyLitreStatement(ms, products, 'TSTS1', '2026-08-11') as unknown as [
      Record<string, number | string>,
      Record<string, number | string>,
      Record<string, number | string>,
    ];
    for (const col of ['opening', 'purchase', 'total', 'sales', 'closing']) {
      expect(grand[col]).toBeCloseTo((beer[col] as number) + (iml[col] as number), 10);
    }
  });
});

describe('remittance', () => {
  it('reports each flow in bottles and at MRP, and closing value = closing qty x MRP', () => {
    const ms = [
      mv('W90', 100, 'opening', D1),
      mv('W90', 40, 'purchase', D2),
      mv('W90', 10, 'transfer_in', D2),
      mv('W90', -5, 'transfer_out', D2),
      mv('W90', -30, 'sale', D2),
      mv('W90', -1, 'loss', D2),
    ];
    const [row] = remittance(ms, products, mrpOf, 'TSTS1', '2026-08-11', '2026-08-11');
    expect(row).toMatchObject({
      productId: 'W90',
      openingQty: 100,
      openingValue: 100 * 5000,
      purchaseQty: 40,
      transferInQty: 10,
      transferOutQty: 5,
      salesQty: 30,
      salesValue: 30 * 5000,
      adjustQty: -1,
      closingQty: 114,
    });
    expect(row!.closingValue).toBe(row!.closingQty * 5000);
  });
});

describe('valuation', () => {
  it('values stock at landed cost and at MRP for one day', () => {
    const ms = [
      mv('W90', 100, 'opening', D1),
      mv('W90', -4, 'purchase_return', D2),
      mv('W90', -30, 'sale', D2),
      mv('W90', 1, 'void', D2),
    ];
    const [row] = valuation(ms, products, costOf, mrpOf, 'TSTS1', '2026-08-11');
    expect(row).toEqual({
      productId: 'W90',
      opening: 100,
      openingValue: 100 * 4000,
      returns: 4,
      returnsValue: 4 * 4000,
      sales: 29,
      salesCost: 29 * 4000,
      closing: 67,
      closingValue: 67 * 4000,
      mrpAmount: 67 * 5000,
    });
  });
});

describe('lossesReport', () => {
  const loss = (storeCode: string, productId: string, qty: number, reason: Loss['reason'], at: string): Loss => ({
    storeCode,
    productId,
    qty,
    reason,
    at,
    by: 'U1',
    ref: 'LOSS',
  });
  it('groups the month by store and reason, with litres', () => {
    const rows = lossesReport(
      [
        loss('TSTS1', 'W90', 2, 'breakage', '2026-08-03T05:00:00Z'),
        loss('TSTS1', 'W90', 3, 'breakage', '2026-08-20T05:00:00Z'),
        loss('TSTS1', 'BEER500', 1, 'theft', '2026-08-20T05:00:00Z'),
        loss('TSTS2', 'W90', 1, 'breakage', '2026-08-21T05:00:00Z'),
        loss('TSTS1', 'W90', 9, 'breakage', '2026-07-31T19:00:00Z'), // 1 Aug 12:30 AM IST: in August
        loss('TSTS1', 'W90', 8, 'breakage', '2026-08-31T19:00:00Z'), // 1 Sep IST: not August
      ],
      products,
      '2026-08',
    );
    expect(rows).toEqual([
      { storeCode: 'TSTS1', reason: 'breakage', qty: 14, litres: 1.26 },
      { storeCode: 'TSTS1', reason: 'theft', qty: 1, litres: 0.5 },
      { storeCode: 'TSTS2', reason: 'breakage', qty: 1, litres: 0.09 },
    ]);
  });
});

describe('discountsReport', () => {
  const offer: Offer = {
    code: 'EFKA102',
    type: 'store',
    productId: 'W90',
    discountType: 'amount',
    amountPerUnit: 500,
    from: '2026-08-01',
    to: '2026-08-31',
    createdBy: 'U-OWNER',
  };
  const bill = (number: string, at: string, status: Bill['status'] = 'paid'): Bill => ({
    number,
    clientId: number,
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId: 'S1',
    at,
    gross: 0,
    discount: 0,
    tax: 0,
    net: 0,
    status,
  });
  const line = (billNumber: string, over: Partial<BillLine>): BillLine => ({
    billNumber,
    productId: 'W90',
    qty: 1,
    mrp: 5000,
    discount: 0,
    tax: 0,
    amount: 5000,
    ...over,
  });

  it('lists a paid bill line that used EFKA102 with its discount of 500', () => {
    const rows = discountsReport(
      [line('B1', { offerCode: 'EFKA102', discount: 500, amount: 4500 }), line('B1', { productId: 'BEER500' })],
      [bill('B1', D2)],
      [offer],
      products,
      '2026-08-11',
      '2026-08-11',
    );
    expect(rows).toEqual([
      { brand: 'W90', offerType: 'store', product: 'W90', offerCode: 'EFKA102', billNumber: 'B1', qty: 1, freeQty: 0, amount: 4500, discount: 500 },
    ]);
  });

  it('skips practice and void bills, other days, and shows free bottles for a buy-N-get-M offer', () => {
    const free: Offer = { ...offer, code: 'FREE1', discountType: 'free_qty', buyQty: 2, freeQty: 1, amountPerUnit: undefined };
    const rows = discountsReport(
      [
        line('B1', { offerCode: 'EFKA102', discount: 500 }),
        line('B2', { offerCode: 'EFKA102', discount: 500 }),
        line('B3', { offerCode: 'EFKA102', discount: 500 }),
        line('B4', { offerCode: 'FREE1', qty: 3, discount: 5000, amount: 10000 }),
      ],
      [bill('B1', D2, 'practice'), bill('B2', D2, 'void'), bill('B3', D3), bill('B4', D2)],
      [offer, free],
      products,
      '2026-08-11',
      '2026-08-11',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billNumber: 'B4', offerCode: 'FREE1', freeQty: 1, discount: 5000 });
  });
});
