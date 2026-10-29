/**
 * Reorder level in bottles: three days of average sales, never below 6.
 * `avgDaily` is the product's average bottles sold per day.
 */
export function minLevel(avgDaily: number): number {
  return Math.max(6, Math.ceil(3 * avgDaily));
}
