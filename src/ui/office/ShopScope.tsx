import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useEffect, useRef, type ReactNode } from 'react'
import { db } from '../../db/db'
import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import { setWorkShop, useSession } from '../shell/session'
import { ShopSelect } from './shared'

/** True under a ShopScope that lets the page header carry the picker (see PageHeader). */
export const ShopInHeader = createContext(false)

/** Set when the user picks a shop, so the rebuilt picker takes the focus back (a keyboard user stays on it). */
let refocusPicker = false
function pickShop(code: string): void {
  refocusPicker = true
  setWorkShop(code)
}

/** The shop being worked on and every shop, for a screen that shows one shop at a time. `undefined` until the shops are read. The choice is kept in the session, so a new login starts on the hub. */
export function useWorkShop(): { stores: Store[]; store: Store; pick(code: string): void } | undefined {
  const { workShop } = useSession()
  const stores = useLiveQuery(() => db.stores.toArray(), [])
  const store = stores?.find((s) => s.code === workShop) ?? stores?.find((s) => s.isHub) ?? stores?.[0]
  return stores && store ? { stores, store, pick: pickShop } : undefined
}

/** A compact shop dropdown. */
export function ShopPicker({ className = 'shop-pick' }: { className?: string }) {
  const work = useWorkShop()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!refocusPicker) return
    refocusPicker = false
    box.current?.querySelector('select')?.focus()
  })
  if (!work) return null
  return (
    <div className={className} ref={box}>
      <ShopSelect stores={work.stores} value={work.store.code} onChange={work.pick} label={t('orders.shop')} />
    </div>
  )
}

/**
 * Runs a shop screen for the chosen shop. The page header of the screen shows the compact picker, or pass
 * `picker={false}` when the caller places a ShopPicker itself. The screen is rebuilt when the shop changes, so nothing
 * typed for one shop leaks into another.
 */
export default function ShopScope({ children, picker = true }: { children: (store: Store) => ReactNode; picker?: boolean }) {
  const work = useWorkShop()
  if (!work) return null
  return (
    <ShopInHeader.Provider value={picker}>
      <div key={work.store.code}>{children(work.store)}</div>
    </ShopInHeader.Provider>
  )
}
