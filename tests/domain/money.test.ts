import { describe, expect, it } from 'vitest';
import { formatINR, rupeesToPaise } from '../../src/domain/money';

describe('formatINR', () => {
  it('formats whole rupees without decimals', () => {
    expect(formatINR(6299000)).toBe('₹62,990');
  });
  it('uses Indian digit grouping', () => {
    expect(formatINR(294160100)).toBe('₹29,41,601');
  });
  it('shows paise when not whole', () => {
    expect(formatINR(17727)).toBe('₹177.27');
  });
  it('formats zero and negatives', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(-17727)).toBe('-₹177.27');
  });
});

describe('rupeesToPaise', () => {
  it('converts to integer paise without float drift', () => {
    expect(rupeesToPaise(177.27)).toBe(17727);
    expect(rupeesToPaise(1.005)).toBe(101);
    expect(rupeesToPaise(0.29)).toBe(29);
    expect(rupeesToPaise(62990)).toBe(6299000);
  });
});
