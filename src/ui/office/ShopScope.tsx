import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore, type ReactNode } from 'react'
import { db } from '../../db/db'
import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import { ShopSelect } from './shared'

/** The hub is where office and manager start; the choice then holds from screen to screen until the page is reloaded. */
const HUB = 'TSTS1'
let chosen = HUB
const listeners = new Set<() => void>()

function pick(code: string): void {
  chosen = code
  for (const listener of listeners) listener()
}

/** Back to the hub. Tests call this so one test's choice does not leak into the next. */
export function resetWorkShop(): void {
  pick(HUB)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The shop being worked on and every shop, for a screen that shows one shop at a time. `undefined` until the shops are read. */
export function useWorkShop(): { stores: Store[]; store: Store; pick(code: string): void } | undefined {
  const code = useSyncExternalStore(subscribe, () => chosen)
  const stores = useLiveQuery(() => db.stores.toArray(), [])
  const store = stores?.find((s) => s.code === code) ?? stores?.find((s) => s.isHub) ?? stores?.[0]
  return stores && store ? { stores, store, pick } : undefined
}

/** A shop picker above a screen that needs a shop. The screen is rebuilt when the shop changes, so nothing typed for one shop leaks into another. */
export default function ShopScope({ children }: { children: (store: Store) => ReactNode }) {
  const work = useWorkShop()
  if (!work) return null
  return (
    <>
      <div className="shop-pick">
        <ShopSelect stores={work.stores} value={work.store.code} onChange={work.pick} label={t('orders.shop')} />
      </div>
      <div key={work.store.code}>{children(work.store)}</div>
    </>
  )
}
