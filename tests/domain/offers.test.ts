import { describe, expect, it } from 'vitest';
import { applicableOffer, offerDiscount } from '../../src/domain/offers';
import type { Offer, Product } from '../../src/domain/types';
import catalogue from '../../src/seed/catalogue.json';

const products = catalogue.products as Product[];
const efkays = products.find((p) => p.description === 'EFKAYS WHISKY 180 - TPACK')!;
const oc90 = products.find((p) => p.description === 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK')!;

const EFKA102: Offer = {
  code: 'EFKA102',
  type: 'store',
  productId: efkays.id,
  discountType: 'amount',
  amountPerUnit: 500,
  from: '2026-10-01',
  to: '2026-11-28',
  createdBy: 'U-OWNER',
};
const b2g1: Offer = {
  code: 'B2G1',
  type: 'store',
  productId: oc90.id,
  discountType: 'free_qty',
  buyQty: 2,
  freeQty: 1,
  from: '2026-10-01',
  to: '2026-10-31',
  createdBy: 'U-OWNER',
};

describe('offerDiscount', () => {
  it('takes the amount off each unit (Efkays 180 at 105 rupees)', () => {
    expect(offerDiscount(EFKA102, 1, 10500)).toBe(500);
    expect(offerDiscount(EFKA102, 2, 10500)).toBe(1000);
  });

  it('never discounts below zero price', () => {
    expect(offerDiscount({ ...EFKA102, amountPerUnit: 99999 }, 2, 10500)).toBe(21000);
  });

  it('buy 2 get 1 free on 3 units at 100 rupees is one free unit', () => {
    expect(offerDiscount(b2g1, 3, 10000)).toBe(10000);
  });

  it('gives a free unit per full group only', () => {
    expect(offerDiscount(b2g1, 2, 10000)).toBe(0);
    expect(offerDiscount(b2g1, 5, 10000)).toBe(10000);
    expect(offerDiscount(b2g1, 6, 10000)).toBe(20000);
  });

  it('is zero for a malformed offer or no units', () => {
    expect(offerDiscount({ ...b2g1, buyQty: 0, freeQty: 0 }, 3, 10000)).toBe(0);
    expect(offerDiscount({ ...EFKA102, amountPerUnit: undefined }, 3, 10000)).toBe(0);
    expect(offerDiscount(EFKA102, 0, 10500)).toBe(0);
  });
});

describe('applicableOffer', () => {
  it('finds a store offer for its product', () => {
    expect(applicableOffer(efkays, [EFKA102], '2026-10-29')).toBe(EFKA102);
    expect(applicableOffer(oc90, [EFKA102], '2026-10-29')).toBeUndefined();
  });

  it('treats the first and last day as inside', () => {
    expect(applicableOffer(efkays, [EFKA102], '2026-10-01')).toBe(EFKA102);
    expect(applicableOffer(efkays, [EFKA102], '2026-11-28')).toBe(EFKA102);
  });

  it('returns undefined for an expired or not yet started offer', () => {
    expect(applicableOffer(efkays, [EFKA102], '2026-11-29')).toBeUndefined();
    expect(applicableOffer(efkays, [EFKA102], '2026-09-30')).toBeUndefined();
  });

  it('matches a brand offer on every product of the brand', () => {
    const brandOffer: Offer = { ...b2g1, code: 'OCB', type: 'brand', productId: undefined, brand: oc90.brand };
    const sameBrand = products.filter((p) => p.brand === oc90.brand);
    expect(sameBrand.length).toBeGreaterThan(1);
    for (const p of sameBrand) expect(applicableOffer(p, [brandOffer], '2026-10-29')).toBe(brandOffer);
    expect(applicableOffer(efkays, [brandOffer], '2026-10-29')).toBeUndefined();
  });

  it('picks the first applicable offer in list order', () => {
    const second: Offer = { ...EFKA102, code: 'SECOND', amountPerUnit: 900 };
    expect(applicableOffer(efkays, [second, EFKA102], '2026-10-29')).toBe(second);
    expect(applicableOffer(efkays, [{ ...second, to: '2026-10-01' }, EFKA102], '2026-10-29')).toBe(EFKA102);
  });
});
