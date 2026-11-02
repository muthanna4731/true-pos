import { db } from './db';

/** The `kv` key of a shop's practice switch. Readers test `kv[practiceKey(shop)].value === true`. */
export const practiceKey = (storeCode: string): string => `practice:${storeCode}`;

/** Turn practice mode on or off for one shop (all its counters). Other shops keep billing for real. */
export async function setPractice(storeCode: string, on: boolean): Promise<void> {
  await db.kv.put({ key: practiceKey(storeCode), value: on });
}
