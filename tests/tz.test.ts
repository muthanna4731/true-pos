import { expect, it } from 'vitest';

it('runs in UTC, not the machine zone, so IST bugs can fail', () => {
  expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
});
