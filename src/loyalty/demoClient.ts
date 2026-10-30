import { db, type TruePosDB } from '../db/db';
import { clock, financialYear, istDate } from '../domain/time';
import type { LoyaltyLedgerRow, Reward } from '../domain/types';
import { LoyaltyError, type LoyaltyClient } from './client';
import { maskName, normalizeCode } from './code';

/** The app's loyalty rules (switch, points per 100 rupees, bill limits, daily cap), as the demo stand-in holds them in `kv.loyaltyConfig`. */
export interface LoyaltyConfig {
  loyaltyEnabled: boolean;
  earnPer100: number;
  minBill: number;
  maxBill: number;
  maxEarnsPerDay: number;
  billRefPattern: string;
}

/** Used when no config was saved. Loyalty is off until the demo panel turns it on (fail-safe). */
export const LOYALTY_DEFAULTS: LoyaltyConfig = {
  loyaltyEnabled: false,
  earnPer100: 1,
  minBill: 100,
  maxBill: 50000,
  maxEarnsPerDay: 2,
  billRefPattern: '^[A-Z0-9/-]{1,20}$',
};

async function readConfig(database: TruePosDB): Promise<LoyaltyConfig> {
  const row = await database.kv.get('loyaltyConfig');
  const saved = row && typeof row.value === 'object' && row.value !== null ? (row.value as Partial<LoyaltyConfig>) : {};
  return { ...LOYALTY_DEFAULTS, ...saved };
}

/**
 * Turn loyalty on or off in the stand-in server (`kv.loyaltyConfig`) and in the POS-side copy (`kv.loyalty`),
 * which `recordSale` reads to decide whether to queue an earn. Always change both together.
 */
export async function setLoyaltyEnabled(on: boolean, database: TruePosDB = db): Promise<void> {
  await database.transaction('rw', database.kv, async () => {
    const config = await readConfig(database);
    await database.kv.put({ key: 'loyaltyConfig', value: { ...config, loyaltyEnabled: on } });
    await database.kv.put({ key: 'loyalty', value: on });
  });
}

/** A member's balance: the sum of all their ledger rows. */
async function balanceOf(database: TruePosDB, memberCode: string): Promise<number> {
  const rows = await database.loyaltyLedger.where('memberCode').equals(memberCode).toArray();
  return rows.reduce((sum, r) => sum + r.points, 0);
}

/** The bill ref as the app reads it: all whitespace removed, then upper case. */
const cleanRef = (raw: string): string => (raw ?? '').replace(/\s/g, '').toUpperCase();

/**
 * Stand-in for the §10.3 RPCs. It follows the rules of the app's `earn_points`, `staff_member_info` and
 * `redeem_reward` in the same order, with the data held in this browser (`loyaltyMembers`, `loyaltyLedger`,
 * `rewards`, `kv.loyaltyConfig`). The `test_account` and `self_credit` checks have no meaning in the demo and are left out.
 */
export class DemoLoyaltyClient implements LoyaltyClient {
  private readonly database: TruePosDB;

  constructor(database: TruePosDB = db) {
    this.database = database;
  }

  async flags(): Promise<{ loyalty: boolean }> {
    return { loyalty: (await readConfig(this.database)).loyaltyEnabled === true };
  }

  async memberInfo(code: string): Promise<{ maskedName: string; points: number }> {
    const member = await this.database.loyaltyMembers.get(normalizeCode(code));
    if (!member) throw new LoyaltyError('member_not_found');
    return { maskedName: maskName(member.name, member.phone), points: await balanceOf(this.database, member.code) };
  }

  earn(code: string, billRupees: number, billRef: string, storeCode: string): Promise<{ maskedName: string; pointsAdded: number; balance: number }> {
    const d = this.database;
    return d.transaction('rw', [d.kv, d.loyaltyMembers, d.loyaltyLedger], async () => {
      const config = await readConfig(d);
      if (!config.loyaltyEnabled) throw new LoyaltyError('loyalty_off');
      const member = await d.loyaltyMembers.get(normalizeCode(code));
      if (!member) throw new LoyaltyError('member_not_found');
      const ref = cleanRef(billRef);
      if (ref === '') throw new LoyaltyError('missing_bill_ref');
      if (!new RegExp(config.billRefPattern).test(ref)) throw new LoyaltyError('bad_bill_ref');

      const now = clock.now();
      const fy = financialYear(now);
      const sameBill = await d.loyaltyLedger.where('[storeCode+fy+billRef]').equals([storeCode, fy, ref]).toArray();
      if (sameBill.some((r) => r.kind === 'earn')) throw new LoyaltyError('duplicate_bill');

      if (!Number.isFinite(billRupees) || billRupees < config.minBill || billRupees > config.maxBill) {
        throw new LoyaltyError('bill_out_of_range');
      }
      const points = Math.floor((billRupees * config.earnPer100) / 100);
      if (points < 1) throw new LoyaltyError('bill_out_of_range');

      const today = istDate(now);
      const earnsToday = (await d.loyaltyLedger.where('memberCode').equals(member.code).toArray()).filter(
        (r) => r.kind === 'earn' && istDate(r.at) === today,
      );
      if (earnsToday.length >= config.maxEarnsPerDay) throw new LoyaltyError('daily_limit');

      await d.loyaltyLedger.add({ memberCode: member.code, points, kind: 'earn', storeCode, fy, billRef: ref, at: now });
      return { maskedName: maskName(member.name, member.phone), pointsAdded: points, balance: await balanceOf(d, member.code) };
    });
  }

  redeem(code: string, rewardId: string, requestId: string, expectedCost: number): Promise<{ balance: number }> {
    const d = this.database;
    return d.transaction('rw', [d.kv, d.loyaltyMembers, d.loyaltyLedger, d.rewards], async () => {
      if (!requestId || typeof expectedCost !== 'number' || Number.isNaN(expectedCost)) throw new LoyaltyError('bad_request');
      const member = await d.loyaltyMembers.get(normalizeCode(code));
      if (!member) throw new LoyaltyError('member_not_found');

      // A retry of a request that already went through is answered before the rules that describe now
      // (the switch, the reward, the balance), so it still succeeds if any of them changed since.
      // A request id is unique across all members; reusing it for anything else is refused.
      const first = (await d.loyaltyLedger.toArray()).find((r) => r.requestId === requestId);
      if (first) {
        if (first.memberCode !== member.code || first.kind !== 'redeem' || first.rewardId !== rewardId || first.points !== -expectedCost) {
          throw new LoyaltyError('bad_request');
        }
        return { balance: await balanceOf(d, member.code) };
      }

      if (!(await readConfig(d)).loyaltyEnabled) throw new LoyaltyError('loyalty_off');
      const reward: Reward | undefined = await d.rewards.get(rewardId);
      if (!reward) throw new LoyaltyError('unknown_reward');
      if (!reward.active) throw new LoyaltyError('reward_inactive');
      if (reward.cost !== expectedCost) throw new LoyaltyError('cost_changed');
      if ((await balanceOf(d, member.code)) < reward.cost) throw new LoyaltyError('insufficient_points');

      const now = clock.now();
      // A redeem belongs to no bill: store and bill ref stay empty.
      await d.loyaltyLedger.add({ memberCode: member.code, points: -reward.cost, kind: 'redeem', storeCode: '', fy: financialYear(now), billRef: '', requestId, rewardId, at: now });
      return { balance: await balanceOf(d, member.code) };
    });
  }

  reverse(billRef: string, storeCode: string): Promise<void> {
    const d = this.database;
    return d.transaction('rw', d.loyaltyLedger, async () => {
      const ref = cleanRef(billRef);
      // Every row of this store, any financial year, then the ones of this bill.
      const ofBill = (
        await d.loyaltyLedger
          .where('[storeCode+fy+billRef]')
          .between([storeCode, '', ''], [storeCode, '\uffff', '\uffff'])
          .toArray()
      ).filter((r) => r.billRef === ref);
      const earn: LoyaltyLedgerRow | undefined = ofBill.find((r) => r.kind === 'earn');
      if (!earn || ofBill.some((r) => r.kind === 'adjust')) return;
      await d.loyaltyLedger.add({ memberCode: earn.memberCode, points: -earn.points, kind: 'adjust', storeCode, fy: earn.fy, billRef: ref, at: clock.now() });
    });
  }

  async rewards(): Promise<Reward[]> {
    return (await this.database.rewards.toArray()).filter((r) => r.active);
  }
}
