import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { practiceKey } from '../../db/settings'

/** Whether practice mode is on at this shop. `undefined` until the switch has been read, so nothing is billed before we know. */
export function usePractice(storeCode: string | undefined): boolean | undefined {
  return useLiveQuery(async () => (storeCode ? (await db.kv.get(practiceKey(storeCode)))?.value === true : undefined), [storeCode])
}
