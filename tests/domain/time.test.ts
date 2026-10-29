import { afterEach, describe, expect, it, vi } from 'vitest';
import { clock, financialYear, formatDate, formatTime, istDate } from '../../src/domain/time';

describe('IST time', () => {
  it('istDate rolls the day over at 18:30Z', () => {
    expect(istDate('2026-08-07T18:30:00.000Z')).toBe('2026-08-08');
    expect(istDate('2026-08-07T18:29:59.000Z')).toBe('2026-08-07');
  });
  it('financialYear flips on 1 April IST', () => {
    expect(financialYear('2026-03-31T18:29:59Z')).toBe('25-26');
    expect(financialYear('2026-03-31T18:30:00Z')).toBe('26-27');
    expect(financialYear('2026-12-31T20:00:00Z')).toBe('26-27');
    expect(financialYear('2026-04-01T00:00:00Z')).toBe('26-27');
  });
  it('financialYear handles the century wrap', () => {
    expect(financialYear('2099-06-01T00:00:00Z')).toBe('99-00');
  });
  it('formatDate and formatTime show IST', () => {
    expect(formatDate('2026-08-12T09:01:00Z')).toBe('12 Aug 2026');
    expect(formatTime('2026-08-12T09:01:00Z')).toBe('2:31 PM');
    expect(formatTime('2026-08-12T18:30:00Z')).toBe('12:00 AM');
    expect(formatDate('2026-09-05T00:00:00Z')).toBe('5 Sep 2026');
  });
});

describe('clock', () => {
  afterEach(() => {
    clock.setOffsetDays(0);
    vi.useRealTimers();
  });
  it('now returns the ISO instant', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-12T09:01:00.000Z'));
    expect(clock.now()).toBe('2026-08-12T09:01:00.000Z');
  });
  it('setOffsetDays shifts now by whole days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-12T09:01:00.000Z'));
    clock.setOffsetDays(3);
    expect(clock.now()).toBe('2026-08-15T09:01:00.000Z');
    clock.setOffsetDays(-1);
    expect(clock.now()).toBe('2026-08-11T09:01:00.000Z');
  });
});
