import { describe, expect, it } from 'vitest';
import { upiUri } from '../../src/domain/upi';

describe('upiUri', () => {
  it('builds the pay link with 2-decimal amount and encoded note', () => {
    expect(upiUri('truespirits1@okaxis', 'True Spirits 1', 37500, 'TSTS1/26-27/100001')).toBe(
      'upi://pay?pa=truespirits1@okaxis&pn=True%20Spirits%201&am=375.00&cu=INR&tn=TSTS1%2F26-27%2F100001',
    );
  });
  it('keeps paise', () => {
    expect(upiUri('a@b', 'X', 17727, 'N')).toContain('&am=177.27&');
  });
});
