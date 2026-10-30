import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'

/** Whether practice mode is on. `undefined` until the switch has been read, so nothing is billed before we know. */
export function usePractice(): boolean | undefined {
  return useLiveQuery(async () => (await db.kv.get('practice'))?.value === true, [])
}
