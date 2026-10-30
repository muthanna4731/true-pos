import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { priceInForce } from '../../src/domain/prices';
import { istDate } from '../../src/domain/time';
import type { Price } from '../../src/domain/types';

const price = (productId: string, mrp: number, effectiveFrom: string): Price => ({
  productId,
  mrp,
  purchase: 0,
  aroed: 0,
  cess: 0,
  effectiveFrom,
  pushedBy: 'seed',
});

describe('priceInForce', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('takes the latest price that has started', () => {
    const prices = [price('P1', 5000, '2026-04-01'), price('P1', 5500, '2026-08-01'), price('P1', 5200, '2026-06-01')];
    expect(priceInForce(prices, '2026-10-29').get('P1')).toBe(5500);
  });

  it('ignores a price that starts in the future, and leaves out a product with no started price', () => {
    const prices = [price('P1', 5000, '2026-04-01'), price('P1', 6000, '2026-11-01'), price('P2', 7000, '2026-11-01')];
    const map = priceInForce(prices, '2026-10-29');
    expect(map.get('P1')).toBe(5000);
    expect(map.has('P2')).toBe(false);
  });

  it('starts a price on its first day, included', () => {
    expect(priceInForce([price('P1', 6000, '2026-05-01')], '2026-05-01').get('P1')).toBe(6000);
  });

  it('switches at midnight IST, not midnight UTC', () => {
    const prices = [price('P1', 5000, '2026-04-01'), price('P1', 6000, '2026-05-01')];
    vi.setSystemTime(new Date('2026-04-30T18:15:00Z')); // 30 Apr 23:45 IST
    expect(priceInForce(prices, istDate(new Date().toISOString())).get('P1')).toBe(5000);
    vi.setSystemTime(new Date('2026-04-30T18:45:00Z')); // 1 May 00:15 IST
    expect(priceInForce(prices, istDate(new Date().toISOString())).get('P1')).toBe(6000);
  });
});
