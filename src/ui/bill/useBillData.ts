import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../db/db'
import { priceInForce } from '../../domain/prices'
import { topSellers } from '../../domain/sellers'
import { clock, istDate } from '../../domain/time'
import type { Offer, Paise, Product } from '../../domain/types'

const DAY_MS = 86400000
const MINUTE_MS = 60000
const WINDOW_DAYS = 14

export interface BillData {
  /** False until products and prices are read. */
  ready: boolean
  /** Products that have a current price. Only these can be sold. */
  products: Product[]
  byId: Map<string, Product>
  mrpOf(id: string): Paise
  offers: Offer[]
  istDay: string
  /** Units sold per product at this shop in the last 14 days. Refreshed once a minute, not on every sale. */
  rank: Map<string, number>
  /** Best sellers, best first. */
  top: string[]
}

interface Sellers {
  rank: Map<string, number>
  top: string[]
}
const NO_SELLERS: Sellers = { rank: new Map(), top: [] }

/** Re-renders once a minute, so the ranking and the price in force stay fresh without chasing every sale. */
function useMinute(): number {
  const [minute, setMinute] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setMinute((m) => m + 1), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])
  return minute
}

/** Paid bills of one shop in the last 14 days (never practice or void), read through the `[storeCode+at]` index. */
async function loadSellers(storeCode: string): Promise<Sellers> {
  const now = clock.now()
  const since = new Date(new Date(now).getTime() - WINDOW_DAYS * DAY_MS).toISOString()
  const bills = await db.bills
    .where('[storeCode+at]')
    .between([storeCode, since], [storeCode, '￿'])
    .filter((b) => b.status === 'paid')
    .toArray()
  const billAt = new Map(bills.map((b) => [b.number, b.at]))
  const lines = await db.billLines.where('billNumber').anyOf([...billAt.keys()]).toArray()
  const rank = new Map<string, number>()
  for (const l of lines) rank.set(l.productId, (rank.get(l.productId) ?? 0) + l.qty)
  const top = topSellers(
    lines.map((l) => ({ productId: l.productId, qty: l.qty, at: billAt.get(l.billNumber) ?? '', storeCode })),
    storeCode,
    now,
  )
  return { rank, top }
}

/** Everything the bill screen reads from the database. */
export function useBillData(storeCode: string | undefined): BillData {
  const minute = useMinute()
  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const prices = useLiveQuery(() => db.prices.toArray(), [])
  const offers = useLiveQuery(() => db.offers.toArray(), [])
  const [sellers, setSellers] = useState<Sellers>(NO_SELLERS)

  useEffect(() => {
    if (!storeCode) return
    let alive = true
    loadSellers(storeCode).then(
      (s) => alive && setSellers(s),
      (err: unknown) => console.error('Could not load the best sellers', err),
    )
    return () => {
      alive = false
    }
  }, [storeCode, minute])

  const istDay = istDate(clock.now())
  // A price that starts today takes effect at 00:00 IST: `istDay` changes on the first re-render after midnight.
  const mrp = useMemo(() => priceInForce(prices ?? [], istDay), [prices, istDay])

  const mrpOf = useCallback((id: string): Paise => mrp.get(id) ?? 0, [mrp])
  const products = useMemo(() => (allProducts ?? []).filter((p) => mrp.has(p.id)), [allProducts, mrp])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  return {
    ready: allProducts !== undefined && prices !== undefined && offers !== undefined,
    products,
    byId,
    mrpOf,
    offers: offers ?? [],
    istDay,
    rank: sellers.rank,
    top: sellers.top,
  }
}
