import { db, type LoyaltyQueueItem } from '../db/db';
import { clock } from '../domain/time';
import { getLoyaltyClient, LoyaltyError, type LoyaltyClient } from './client';

interface Result {
  sent: number;
  dropped: number;
  kept: number;
}

const ERRORS_KEY = 'loyaltyErrors';
const MAX_ERRORS = 50;

/** Why a refused item was dropped, kept in `kv.loyaltyErrors` (newest last, the last 50) for the manager to look at. */
async function recordError(item: LoyaltyQueueItem, code: string): Promise<void> {
  const row = await db.kv.get(ERRORS_KEY);
  const old = Array.isArray(row?.value) ? (row.value as unknown[]) : [];
  const entry = { code, billRef: 'reverse' in item ? item.reverse : item.billRef, at: clock.now() };
  await db.kv.put({ key: ERRORS_KEY, value: [...old, entry].slice(-MAX_ERRORS) });
}

/** Send one item. Throws whatever the client throws. A reverse names only the bill, so its store comes from the bill row. */
async function send(client: LoyaltyClient, item: LoyaltyQueueItem): Promise<'sent' | 'dropped'> {
  if ('reverse' in item) {
    const bill = await db.bills.get(item.reverse);
    if (!bill) return 'dropped';
    await client.reverse(bill.number, bill.storeCode);
    return 'sent';
  }
  await client.earn(item.memberCode, item.billRupees, item.billRef, item.storeCode);
  return 'sent';
}

async function flushOnce(client: LoyaltyClient): Promise<Result> {
  const result: Result = { sent: 0, dropped: 0, kept: 0 };
  const items = await db.loyaltyQueue.orderBy('id').toArray();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = item.id as number;
    try {
      result[await send(client, item)]++;
      await db.loyaltyQueue.delete(id);
    } catch (e) {
      // Not a refusal from the server (a failed fetch, say): treat it as being offline.
      const code = e instanceof LoyaltyError ? e.code : 'network';
      if (code === 'network') {
        result.kept = items.length - i;
        return result;
      }
      // `loyalty_off` and `duplicate_bill` are expected outcomes; anything else is worth a record.
      if (code !== 'loyalty_off' && code !== 'duplicate_bill') await recordError(item, code);
      await db.loyaltyQueue.delete(id);
      result.dropped++;
    }
  }
  return result;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Send the queued earns and reversals in order. A refusal that cannot change (loyalty switched off, a bill
 * already earned) drops the item; any other refusal drops it and records it in `kv.loyaltyErrors`;
 * a network failure keeps it and stops, to try again later. Runs one at a time, so a second call waits for the first.
 */
export function flushLoyaltyQueue(client: LoyaltyClient): Promise<Result> {
  const run = tail.then(() => flushOnce(client));
  tail = run.catch(() => undefined);
  return run;
}

/** Flush with the registered client, if there is one. For the places that just want the queue sent: never throws. */
export function flushLoyaltyNow(): void {
  const client = getLoyaltyClient();
  if (client) void flushLoyaltyQueue(client).catch(() => undefined);
}
