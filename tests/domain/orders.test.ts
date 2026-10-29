import { describe, expect, it } from 'vitest';
import { minLevel } from '../../src/domain/orders';

describe('minLevel', () => {
  it('is three days of average sales, never below 6 bottles', () => {
    expect(minLevel(0)).toBe(6);
    expect(minLevel(1.5)).toBe(6);
    expect(minLevel(2)).toBe(6);
    expect(minLevel(2.1)).toBe(7);
    expect(minLevel(130)).toBe(390);
  });
});
