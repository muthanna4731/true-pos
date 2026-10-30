import { describe, expect, it } from 'vitest';
import { isMemberCode, maskName, normalizeCode } from '../../src/loyalty/code';

describe('normalizeCode', () => {
  it('strips the TS1: prefix, dashes and spaces, then upper-cases', () => {
    expect(normalizeCode('TS1:7k3m-9qx2ra')).toBe('7K3M9QX2RA');
    expect(normalizeCode('ts1:7K3M 9QX2RA')).toBe('7K3M9QX2RA');
  });

  it('reads look-alike letters as digits', () => {
    expect(normalizeCode('o1lI')).toBe('0111');
  });

  it('leaves a bottle barcode alone', () => {
    expect(normalizeCode('8901234567890')).toBe('8901234567890');
  });
});

describe('isMemberCode', () => {
  it('accepts a member code, however it was typed', () => {
    expect(isMemberCode('7K3M9QX2RA')).toBe(true);
    expect(isMemberCode('TS1:7k3m-9qx2ra')).toBe(true);
  });

  it('rejects a bottle barcode and other text', () => {
    expect(isMemberCode('8901234567890')).toBe(false);
    expect(isMemberCode('')).toBe(false);
    expect(isMemberCode('7K3M9QX2R')).toBe(false);
  });
});

describe('maskName', () => {
  it('shows the first letter and the last 4 digits', () => {
    expect(maskName('Ravi', '9845014821')).toBe('R••• ··4821');
  });

  it('copes with a Kannada name', () => {
    expect(maskName('ರವಿ', '9845014821')).toBe('ರ••• ··4821');
  });
});
