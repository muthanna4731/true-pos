import { describe, expect, it } from 'vitest';
import { cashFromNotes, changeNotes, quickTenders, validateSplit } from '../../src/domain/cash';

describe('changeNotes', () => {
  it('gives the fewest notes', () => {
    expect(changeNotes(15000)).toEqual({
      notes: [
        { rupees: 100, count: 1 },
        { rupees: 50, count: 1 },
      ],
      coins: 0,
    });
  });

  it('leaves what notes cannot cover as coins', () => {
    expect(changeNotes(1700)).toEqual({ notes: [{ rupees: 10, count: 1 }], coins: 700 });
  });

  it('keeps part-rupee paise in the coins', () => {
    expect(changeNotes(1050)).toEqual({ notes: [{ rupees: 10, count: 1 }], coins: 50 });
  });

  it('gives nothing back for zero change', () => {
    expect(changeNotes(0)).toEqual({ notes: [], coins: 0 });
  });

  it('uses several of the same note', () => {
    expect(changeNotes(120000)).toEqual({
      notes: [
        { rupees: 500, count: 2 },
        { rupees: 200, count: 1 },
      ],
      coins: 0,
    });
  });
});

describe('quickTenders', () => {
  it('offers exact and the notes above the total', () => {
    expect(quickTenders(37500)).toEqual(['exact', 50000, 100000, 200000]);
  });

  it('drops notes that are not above the total', () => {
    expect(quickTenders(120000)).toEqual(['exact', 200000]);
  });

  it('does not offer a note equal to the total', () => {
    expect(quickTenders(50000)).toEqual(['exact', 100000, 200000]);
  });
});

describe('cashFromNotes', () => {
  it('adds notes (by rupee value) and coins in paise', () => {
    expect(cashFromNotes({ 500: 2, 100: 3 }, 500)).toBe(130500);
  });

  it('is zero for an empty drawer', () => {
    expect(cashFromNotes({}, 0)).toBe(0);
  });
});

describe('validateSplit', () => {
  const cash = { mode: 'cash' as const, amount: 50000 };
  const upi = { mode: 'upi' as const, amount: 50000 };

  it('accepts parts that add up, with one amount per mode', () => {
    expect(validateSplit(100000, [cash, upi])).toBe(true);
  });

  it('rejects parts that do not add up', () => {
    expect(validateSplit(100000, [cash, { mode: 'upi', amount: 40000 }])).toBe(false);
  });

  it('rejects a zero amount', () => {
    expect(validateSplit(50000, [cash, { mode: 'upi', amount: 0 }])).toBe(false);
  });

  it('rejects a repeated mode', () => {
    expect(validateSplit(100000, [cash, { mode: 'cash', amount: 50000 }])).toBe(false);
  });

  it('rejects an empty split', () => {
    expect(validateSplit(0, [])).toBe(false);
  });
});
