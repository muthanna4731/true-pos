import { describe, expect, it } from 'vitest';
import { billNumber, parseBillNumber, practiceBillNumber } from '../../src/domain/billNumber';

describe('billNumber', () => {
  it('counter 1 is unpadded', () => {
    expect(billNumber('TSTS1', 1, '26-27', 122088)).toBe('TSTS1/26-27/122088');
  });
  it('counter 2+ adds the counter and pads seq to 6', () => {
    const n = billNumber('TSTS1', 2, '26-27', 123);
    expect(n).toBe('TSTS1-2/26-27/000123');
    expect(n).toHaveLength(20);
  });
  it('throws when longer than 20 characters', () => {
    expect(() => billNumber('TSTS1', 10, '26-27', 1)).toThrow('bill_number_too_long');
  });
  it('always matches the allowed pattern', () => {
    expect(billNumber('TSGLD', 3, '25-26', 999999)).toMatch(/^[A-Z0-9/-]{1,20}$/);
  });
});

describe('practiceBillNumber', () => {
  it('counter 1 has a bare P and pads seq to 6', () => {
    expect(practiceBillNumber('TSTS1', 1, '26-27', 1)).toBe('TSTS1P/26-27/000001');
  });
  it('counter 2+ puts the counter after the P', () => {
    expect(practiceBillNumber('TSTS1', 2, '26-27', 12)).toBe('TSTS1P2/26-27/000012');
  });
  it('worst case is exactly 20 characters', () => {
    const n = practiceBillNumber('TSGLD', 2, '26-27', 1);
    expect(n).toBe('TSGLDP2/26-27/000001');
    expect(n).toHaveLength(20);
    expect(n).toMatch(/^[A-Z0-9/-]{1,20}$/);
  });
  it('throws when longer than 20 characters', () => {
    expect(() => practiceBillNumber('TSGLD', 10, '26-27', 1)).toThrow('bill_number_too_long');
  });
});

describe('parseBillNumber', () => {
  it('parses a counter 2 number', () => {
    expect(parseBillNumber('TSTS1-2/26-27/000123')).toEqual({ store: 'TSTS1', counter: 2, fy: '26-27', seq: 123 });
  });
  it('parses a counter 1 number', () => {
    expect(parseBillNumber('TSTS1/26-27/122088')).toEqual({ store: 'TSTS1', counter: 1, fy: '26-27', seq: 122088 });
  });
  it('round-trips', () => {
    const n = billNumber('TSTS7', 4, '26-27', 42);
    expect(parseBillNumber(n)).toEqual({ store: 'TSTS7', counter: 4, fy: '26-27', seq: 42 });
  });
  it('throws on garbage', () => {
    expect(() => parseBillNumber('nope')).toThrow('bad_bill_number');
  });
});
