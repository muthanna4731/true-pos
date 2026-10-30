import Dexie from 'dexie'
import { db } from '../../db/db'
import { clock } from '../../domain/time'
import { shopLabel } from '../../domain/todos'
import type { Product, StockMovement, Store } from '../../domain/types'
import { t } from '../../i18n'

/** The time to the minute, so values derived from it hold between renders. */
export const nowMinute = (): string => `${clock.now().slice(0, 16)}:00.000Z`

/** One shop's movements, read from the `[storeCode+at]` index (never the whole ledger). */
export function shopMovements(storeCode: string): Promise<StockMovement[]> {
  return db.movements.where('[storeCode+at]').between([storeCode, Dexie.minKey], [storeCode, Dexie.maxKey]).toArray()
}

/** Product short name, falling back to the description, then the id. */
export const nameOf = (products: Map<string, Product>, id: string): string => products.get(id)?.shortName || products.get(id)?.description || id

export const LOSS_REASONS = ['breakage', 'leakage', 'shortage', 'theft', 'expired'] as const

/** A shop dropdown. `allLabel` adds an "all shops" choice with the empty value. */
export function ShopSelect({
  stores,
  value,
  onChange,
  label,
  allLabel,
}: {
  stores: Store[]
  value: string
  onChange(code: string): void
  label: string
  allLabel?: string
}) {
  return (
    <label>
      {label}{' '}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allLabel && <option value="">{allLabel}</option>}
        {stores.map((s) => (
          <option key={s.code} value={s.code}>
            {shopLabel(s, s.code)} {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Run a write once at a time: ignores a second tap while the first is saving. Returns the error code, or null. */
export async function guarded(busy: { current: boolean }, work: () => Promise<void>): Promise<string | null> {
  if (busy.current) return 'busy'
  busy.current = true
  try {
    await work()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'failed'
  } finally {
    busy.current = false
  }
}

export const errorText = (code: string): string => (code === 'permit_required' ? t('tr.permitRequired') : code === 'busy' ? '' : t('orders.failed'))
