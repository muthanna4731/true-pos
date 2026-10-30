import { db } from './db';

/** Turn practice mode on or off. Readers test `kv.practice.value === true`. */
export async function setPractice(on: boolean): Promise<void> {
  await db.kv.put({ key: 'practice', value: on });
}
