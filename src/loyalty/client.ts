import type { Reward } from '../domain/types';

/** Why the server refused. These are the app's own error names (§10.3), plus `network` for "could not reach it". */
export type LoyaltyErrorCode =
  | 'loyalty_off'
  | 'member_not_found'
  | 'test_account'
  | 'self_credit'
  | 'missing_bill_ref'
  | 'bad_bill_ref'
  | 'duplicate_bill'
  | 'bill_out_of_range'
  | 'daily_limit'
  | 'insufficient_points'
  | 'network';

export class LoyaltyError extends Error {
  readonly code: LoyaltyErrorCode;

  constructor(code: LoyaltyErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LoyaltyError';
    this.code = code;
  }
}

/** The §10.3 RPCs, camelCased. The demo stand-in and a future Supabase client both implement it. */
export interface LoyaltyClient {
  /** `pos_flags()`: is loyalty switched on. */
  flags(): Promise<{ loyalty: boolean }>;
  /** `pos_member_info`: the masked name (see `maskName`) and the points balance. */
  memberInfo(code: string): Promise<{ maskedName: string; points: number }>;
  /** `pos_earn`: points for a paid bill, using the real bill amount and number. */
  earn(code: string, billRupees: number, billRef: string, storeCode: string): Promise<{ points: number }>;
  /** `pos_redeem`: idempotent on `requestId`. */
  redeem(code: string, rewardId: string, requestId: string, expectedCost: number): Promise<{ points: number }>;
  /** `pos_reverse`: take back the points of a voided bill. */
  reverse(billRef: string, storeCode: string): Promise<void>;
  /** The active rewards. */
  rewards(): Promise<Reward[]>;
}

let current: LoyaltyClient | null = null;

/** Task 10 registers the demo stand-in here. Until then there is no client and loyalty reads as unknown. */
export function setLoyaltyClient(client: LoyaltyClient | null): void {
  current = client;
}

export function getLoyaltyClient(): LoyaltyClient | null {
  return current;
}
