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
  | 'unknown_reward'
  | 'reward_inactive'
  | 'cost_changed'
  | 'bad_request'
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
  /**
   * `pos_earn`: points for a paid bill, using the real bill amount and number.
   * `billRupees` is whole rupees, `Math.floor(net paise / 100)`.
   */
  earn(code: string, billRupees: number, billRef: string, storeCode: string): Promise<{ maskedName: string; pointsAdded: number; balance: number }>;
  /** `pos_redeem`: idempotent on `requestId`. `balance` is the points left after the redeem. */
  redeem(code: string, rewardId: string, requestId: string, expectedCost: number): Promise<{ balance: number }>;
  /** `pos_reverse`: take back the points of a voided bill. */
  reverse(billRef: string, storeCode: string): Promise<void>;
  /** The active rewards. */
  rewards(): Promise<Reward[]>;
}

let current: LoyaltyClient | null = null;

/** The app registers the demo stand-in here at start-up. With no client, loyalty reads as unknown (off). */
export function setLoyaltyClient(client: LoyaltyClient | null): void {
  current = client;
}

export function getLoyaltyClient(): LoyaltyClient | null {
  return current;
}
