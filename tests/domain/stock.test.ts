import { describe, expect, it } from 'vitest';
import { onHand, productHistory } from '../../src/domain/stock';
import type { MovementKind, StockMovement } from '../../src/domain/types';

const mv = (qty: number, kind: MovementKind, at: string, id?: number, store = 'TSTS1', product = 'P0001'): StockMovement => ({
  id,
  storeCode: store,
  productId: product,
  qty,
  kind,
  ref: 'r',
  at,
});

describe('onHand', () => {
  it('sums the signed movements', () => {
    const m = [
      mv(24, 'opening', '2026-10-01T00:00:00Z'),
      mv(-5, 'sale', '2026-10-02T00:00:00Z'),
      mv(-6, 'transfer_out', '2026-10-03T00:00:00Z'),
      mv(1, 'void', '2026-10-04T00:00:00Z'),
    ];
    expect(onHand(m, 'TSTS1', 'P0001')).toBe(14);
  });
  it('ignores other stores and products', () => {
    const m = [mv(10, 'opening', '2026-10-01T00:00:00Z'), mv(99, 'opening', '2026-10-01T00:00:00Z', 1, 'TSTS2'), mv(99, 'opening', '2026-10-01T00:00:00Z', 2, 'TSTS1', 'P0002')];
    expect(onHand(m, 'TSTS1', 'P0001')).toBe(10);
  });
  it('is 0 with no movements', () => {
    expect(onHand([], 'TSTS1', 'P0001')).toBe(0);
  });
});

describe('productHistory', () => {
  it('returns only that product and store, newest first, without mutating the input', () => {
    const m = [
      mv(24, 'opening', '2026-10-01T00:00:00Z', 1),
      mv(-5, 'sale', '2026-10-03T00:00:00Z', 2),
      mv(7, 'purchase', '2026-10-02T00:00:00Z', 3),
      mv(9, 'opening', '2026-10-09T00:00:00Z', 4, 'TSTS2'),
    ];
    const h = productHistory(m, 'TSTS1', 'P0001');
    expect(h.map((x) => x.kind)).toEqual(['sale', 'purchase', 'opening']);
    expect(m[0].kind).toBe('opening');
  });
  it('puts the later row first when the time is equal', () => {
    const m = [mv(1, 'purchase', '2026-10-01T00:00:00Z', 1), mv(-1, 'sale', '2026-10-01T00:00:00Z', 2)];
    expect(productHistory(m, 'TSTS1', 'P0001').map((x) => x.id)).toEqual([2, 1]);
  });
});
