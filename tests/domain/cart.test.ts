import { describe, expect, it } from 'vitest';
import { cartReducer, priceCart, type Cart } from '../../src/domain/cart';
import type { Offer, Product } from '../../src/domain/types';
import catalogue from '../../src/seed/catalogue.json';

const products = catalogue.products as Product[];
const byId = new Map(products.map((p) => [p.id, p]));
const mrpTable = catalogue.mrp as Record<string, number>;
const mrpOf = (id: string) => mrpTable[id]! * 100;
const find = (d: string) => products.find((p) => p.description === d)!;
const oc90 = find('ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK');
const ub500 = find('UB EXPORT PREMIUM LAGER BEER 500 - CAN');
const efkays = find('EFKAYS WHISKY 180 - TPACK');
const DAY = '2026-10-29';

const empty: Cart = { clientId: 'c1', lines: [] };

describe('cartReducer', () => {
  it('adds a new line, and a second add makes qty 2', () => {
    const once = cartReducer(empty, { type: 'add', productId: 'A' });
    expect(once.lines).toEqual([{ productId: 'A', qty: 1 }]);
    const twice = cartReducer(once, { type: 'add', productId: 'A' });
    expect(twice.lines).toEqual([{ productId: 'A', qty: 2 }]);
  });

  it('keeps line order and does not mutate the old cart', () => {
    const a = cartReducer(empty, { type: 'add', productId: 'A' });
    const b = cartReducer(a, { type: 'add', productId: 'B' });
    const a2 = cartReducer(b, { type: 'add', productId: 'A' });
    expect(a2.lines.map((l) => l.productId)).toEqual(['A', 'B']);
    expect(a.lines).toEqual([{ productId: 'A', qty: 1 }]);
    expect(b.lines).toHaveLength(2);
  });

  it('setQty changes the quantity and 0 removes the line', () => {
    let c = cartReducer(empty, { type: 'add', productId: 'A' });
    c = cartReducer(c, { type: 'setQty', productId: 'A', qty: 5 });
    expect(c.lines).toEqual([{ productId: 'A', qty: 5 }]);
    c = cartReducer(c, { type: 'setQty', productId: 'A', qty: 0 });
    expect(c.lines).toEqual([]);
  });

  it('setQty ignores an unknown product and bad numbers', () => {
    const c = cartReducer(empty, { type: 'add', productId: 'A' });
    expect(cartReducer(c, { type: 'setQty', productId: 'Z', qty: 3 })).toEqual(c);
    expect(cartReducer(c, { type: 'setQty', productId: 'A', qty: NaN })).toEqual(c);
    expect(cartReducer(c, { type: 'setQty', productId: 'A', qty: 2.7 }).lines).toEqual([{ productId: 'A', qty: 2 }]);
    expect(cartReducer(c, { type: 'setQty', productId: 'A', qty: -1 }).lines).toEqual([]);
  });

  it('removes a line', () => {
    let c = cartReducer(empty, { type: 'add', productId: 'A' });
    c = cartReducer(c, { type: 'add', productId: 'B' });
    expect(cartReducer(c, { type: 'remove', productId: 'A' }).lines).toEqual([{ productId: 'B', qty: 1 }]);
  });

  it('sets and clears the member code', () => {
    const m = cartReducer(empty, { type: 'member', code: '7K3M9QX2RA' });
    expect(m.memberCode).toBe('7K3M9QX2RA');
    const none = cartReducer(m, { type: 'member' });
    expect(none.memberCode).toBeUndefined();
    expect('memberCode' in none).toBe(false);
  });

  it('clear empties lines and member but keeps the clientId', () => {
    let c = cartReducer(empty, { type: 'add', productId: 'A' });
    c = cartReducer(c, { type: 'member', code: 'X' });
    expect(cartReducer(c, { type: 'clear' })).toEqual({ clientId: 'c1', lines: [] });
  });
});

describe('priceCart', () => {
  it('prices 5 OC 90 + 1 UB 500 can at 375 rupees with no tax', () => {
    let c = empty;
    for (let i = 0; i < 5; i++) c = cartReducer(c, { type: 'add', productId: oc90.id });
    c = cartReducer(c, { type: 'add', productId: ub500.id });
    const r = priceCart(c, byId, mrpOf, [], DAY);
    expect(r.gross).toBe(37500);
    expect(r.discount).toBe(0);
    expect(r.net).toBe(37500);
    expect(r.tax).toBe(0);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toEqual({
      productId: oc90.id,
      shortName: 'OC 90',
      qty: 5,
      mrp: 5500,
      discount: 0,
      tax: 0,
      amount: 27500,
    });
  });

  it('takes tax out of a tax-inclusive MRP', () => {
    const taxed: Product = { ...oc90, id: 'T1', taxRateBp: 1800 };
    const r = priceCart(
      { clientId: 'c', lines: [{ productId: 'T1', qty: 1 }] },
      new Map([['T1', taxed]]),
      () => 11800,
      [],
      DAY,
    );
    expect(r.tax).toBe(1800);
    expect(r.net).toBe(11800);
  });

  it('computes tax on the amount after the offer, rounded per line', () => {
    const taxed: Product = { ...oc90, id: 'T1', taxRateBp: 1800 };
    const offer: Offer = {
      code: 'T',
      type: 'store',
      productId: 'T1',
      discountType: 'amount',
      amountPerUnit: 1800,
      from: DAY,
      to: DAY,
      createdBy: 'U',
    };
    const r = priceCart({ clientId: 'c', lines: [{ productId: 'T1', qty: 2 }] }, new Map([['T1', taxed]]), () => 11800, [offer], DAY);
    expect(r.lines[0]!.amount).toBe(20000);
    expect(r.lines[0]!.tax).toBe(Math.round((20000 * 1800) / 11800));
    expect(r.tax).toBe(r.lines[0]!.tax);
  });

  it('applies an offer to the line and records its code', () => {
    const offer: Offer = {
      code: 'EFKA102',
      type: 'store',
      productId: efkays.id,
      discountType: 'amount',
      amountPerUnit: 500,
      from: '2026-10-01',
      to: '2026-11-28',
      createdBy: 'U-OWNER',
    };
    let c = cartReducer(empty, { type: 'add', productId: efkays.id });
    c = cartReducer(c, { type: 'add', productId: efkays.id });
    c = cartReducer(c, { type: 'add', productId: ub500.id });
    const r = priceCart(c, byId, mrpOf, [offer], DAY);
    const e = r.lines.find((l) => l.productId === efkays.id)!;
    expect(e).toMatchObject({ qty: 2, mrp: 10500, offerCode: 'EFKA102', discount: 1000, amount: 20000 });
    const u = r.lines.find((l) => l.productId === ub500.id)!;
    expect('offerCode' in u).toBe(false);
    expect(r.gross).toBe(21000 + 10000);
    expect(r.discount).toBe(1000);
    expect(r.net).toBe(30000);
  });

  it('leaves offerCode off when the offer gives nothing yet (buy 2 get 1 with 1 in the cart)', () => {
    const offer: Offer = {
      code: 'B2G1',
      type: 'store',
      productId: oc90.id,
      discountType: 'free_qty',
      buyQty: 2,
      freeQty: 1,
      from: DAY,
      to: DAY,
      createdBy: 'U',
    };
    const r = priceCart({ clientId: 'c', lines: [{ productId: oc90.id, qty: 1 }] }, byId, mrpOf, [offer], DAY);
    expect(r.lines[0]!.discount).toBe(0);
    expect('offerCode' in r.lines[0]!).toBe(false);
  });

  it('prices an empty cart as zero and rejects an unknown product', () => {
    expect(priceCart(empty, byId, mrpOf, [], DAY)).toEqual({ lines: [], gross: 0, discount: 0, tax: 0, net: 0 });
    expect(() => priceCart({ clientId: 'c', lines: [{ productId: 'NOPE', qty: 1 }] }, byId, mrpOf, [], DAY)).toThrow(
      'unknown_product',
    );
  });
});
