import type { StockMovement } from './types';

function forProduct(movements: StockMovement[], storeCode: string, productId: string): StockMovement[] {
  return movements.filter((m) => m.storeCode === storeCode && m.productId === productId);
}

/** Stock on hand: the sum of the signed movements for one product in one store. */
export function onHand(movements: StockMovement[], storeCode: string, productId: string): number {
  return forProduct(movements, storeCode, productId).reduce((sum, m) => sum + m.qty, 0);
}

/** One product's movements in one store, newest first (ties: later row first). */
export function productHistory(movements: StockMovement[], storeCode: string, productId: string): StockMovement[] {
  return forProduct(movements, storeCode, productId).sort((a, b) =>
    a.at === b.at ? (b.id ?? 0) - (a.id ?? 0) : a.at < b.at ? 1 : -1,
  );
}

/** How a counted quantity compares with what was expected: all there, fewer, or more. */
export function lineStatus(expected: number, counted: number): 'match' | 'short' | 'extra' {
  return counted === expected ? 'match' : counted < expected ? 'short' : 'extra';
}
