import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../../src/db/db';
import { buildProduct } from '../../../src/domain/catalogue';
import { clock } from '../../../src/domain/time';
import { useBillData } from '../../../src/ui/bill/useBillData';
import { useClockOffset } from '../../../src/ui/useClockOffset';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const DAY_MS = 86400000;
const product = buildProduct({ subcategory: 'WHISKY', description: 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', mrpRupees: 0 }, 1);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await db.products.add(product);
  await db.prices.add({ productId: product.id, mrp: 5500, purchase: 4000, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'seed' });
  // Sold 13 days ago: inside the 14-day window today, outside it two days later.
  const at = new Date(Date.parse(NOON_IST) - 13 * DAY_MS).toISOString();
  await db.bills.add({ number: 'B1', clientId: 'c1', storeCode: 'TSTS1', counter: 1, cashierId: 'U', shiftId: 'S', at, gross: 5500, discount: 0, tax: 0, net: 5500, status: 'paid' });
  await db.billLines.add({ billNumber: 'B1', productId: product.id, qty: 3, mrp: 5500, discount: 0, tax: 0, amount: 16500 });
});

afterEach(() => {
  act(() => clock.setOffsetDays(0));
  vi.useRealTimers();
});

describe('useBillData', () => {
  it('refreshes the top tiles when the demo clock moves to the next day', async () => {
    const { result } = renderHook(() => {
      useClockOffset();
      return useBillData('TSTS1');
    });
    await waitFor(() => expect(result.current.top).toEqual([product.id]));
    act(() => clock.setOffsetDays(2));
    await waitFor(() => expect(result.current.top).toEqual([]));
  });
});
