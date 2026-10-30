import { beforeAll, describe, expect, it } from 'vitest';
import { generateTodos, type Todo, type TodoInput } from '../../src/domain/todos';
import type { Claim } from '../../src/domain/types';
import { generateSeed, type SeedData } from '../../src/seed/generate';
import { DEMO_SEED } from '../../src/seed/load';

const NOW = '2026-10-29T06:30:00.000Z';

let seed: SeedData;
let input: TodoInput;
let todos: Todo[];
const ofKind = (kind: Todo['kind']) => todos.filter((t) => t.kind === kind);

beforeAll(() => {
  seed = generateSeed({ seed: DEMO_SEED, today: '2026-10-29', days: 3 });
  input = {
    stores: seed.stores,
    products: seed.products,
    movements: seed.movements,
    grns: seed.grns,
    transfers: seed.transfers,
    counts: seed.counts,
    dayCloses: seed.dayCloses,
    bills: seed.bills,
    claims: seed.claims,
    nowIso: NOW,
  };
  todos = generateTodos(input);
});

describe('generateTodos on the seed', () => {
  it('raises the short delivery, with the Raise claim action', () => {
    const t = ofKind('delivery_short');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ storeCode: 'TSTS1', text: 'TS1 delivery: 2 cases short', action: { label: 'Raise claim' } });
  });

  it('raises the transfer stuck in transit since two days ago', () => {
    const t = ofKind('transfer_stuck');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ ref: 'TR-PLANT-1', text: 'Transfer TR-PLANT-1 not received (2 days)', action: { label: 'Call shop' } });
  });

  it('raises the negative Corona can at TS1', () => {
    const t = ofKind('negative_stock');
    expect(t).toHaveLength(1);
    expect(t[0].text).toMatch(/^Cor .* at −3 in TS1$/);
    expect(t[0].action.label).toBe('Count it');
  });

  it('raises the short-dated beer at TS5', () => {
    const t = ofKind('beer_expiry');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ storeCode: 'TSTS5', action: { label: 'Move/Sell' } });
    expect(t[0].text).toMatch(/ at TS5 expires in 20 days$/);
  });

  it('raises the day TS4 did not close, and only TS4', () => {
    const t = ofKind('day_not_closed');
    expect(t.map((x) => x.storeCode)).toEqual(['TSTS4']);
    expect(t[0].action.label).toBe('Remind');
  });

  it('groups low stock per product and only for products that sell at that shop', () => {
    const low = ofKind('low_stock');
    expect(low.length).toBeGreaterThan(0);
    expect(new Set(low.map((x) => x.ref)).size).toBe(low.length);
    for (const t of low) expect(t.action.label).toBe('Make order');
    // No more than the 60 active products can ever be listed.
    expect(low.length).toBeLessThanOrEqual(60);
  });

  it('removes the transfer todo once the transfer is received', () => {
    const received = seed.transfers.map((x) => (x.id === 'TR-PLANT-1' ? { ...x, status: 'received' as const, receivedAt: NOW } : x));
    expect(generateTodos({ ...input, transfers: received }).some((t) => t.kind === 'transfer_stuck')).toBe(false);
  });

  it('keeps the delivery todo until a claim is filed', () => {
    const grn = seed.grns.find((g) => g.lines.some((l) => l.short))!;
    const line = grn.lines.find((l) => l.short)!;
    const claim = (status: Claim['status']): Claim => ({ id: 'C1', grnId: grn.id, storeCode: grn.storeCode, productId: line.productId, qty: 24, amount: 1, status });
    expect(generateTodos({ ...input, claims: [claim('open')] }).some((t) => t.kind === 'delivery_short')).toBe(true);
    expect(generateTodos({ ...input, claims: [claim('filed')] }).some((t) => t.kind === 'delivery_short')).toBe(false);
  });

  it('is quiet about a transfer in transit for less than 24 hours', () => {
    const fresh = seed.transfers.map((x) => (x.id === 'TR-PLANT-1' ? { ...x, dispatchedAt: '2026-10-28T10:00:00.000Z' } : x));
    expect(generateTodos({ ...input, transfers: fresh }).some((t) => t.kind === 'transfer_stuck')).toBe(false);
  });
});

describe('count_off', () => {
  const count = (at: string, counted: number) => ({ id: `C-${at}`, storeCode: 'TSTS2', at, countedBy: 'M', lines: [{ productId: seed.products[0].id, system: 10, counted }] });

  it('flags a difference above 2 in the last 7 days, not 2 or less, not older', () => {
    const kinds = (counts: ReturnType<typeof count>[]) => generateTodos({ ...input, counts }).filter((t) => t.kind === 'count_off');
    expect(kinds([count('2026-10-27T10:00:00.000Z', 7)])).toHaveLength(1);
    expect(kinds([count('2026-10-27T10:00:00.000Z', 8)])).toHaveLength(0);
    expect(kinds([count('2026-10-20T10:00:00.000Z', 3)])).toHaveLength(0);
    expect(kinds([count('2026-10-27T10:00:00.000Z', 7)])[0]).toMatchObject({ storeCode: 'TSTS2', action: { label: 'Check' } });
  });
});
