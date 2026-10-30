import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { db } from '../../db/db'
import { cartReducer, priceCart, type Cart as CartState, type PricedCart } from '../../domain/cart'
import { formatINR } from '../../domain/money'
import { brandTiles } from '../../domain/sellers'
import { searchProducts } from '../../domain/search'
import { newId } from '../../domain/id'
import { onHand } from '../../domain/stock'
import type { Bill, Product } from '../../domain/types'
import { t } from '../../i18n'
import { useSession } from '../shell/session'
import { useScanner } from '../shell/useScanner'
import Cart from './Cart'
import CatalogueGrid from './CatalogueGrid'
import SearchBox from './SearchBox'
import TopTiles from './TopTiles'
import TypeTabs, { typeOf, type Tab } from './TypeTabs'
import { useBillData } from './useBillData'

const NOTICE_MS = 4000

/** What the pay buttons (next task) are given. */
interface PayButtonsProps {
  priced: PricedCart
  cart: CartState
  onPaid(bill: Bill): void
}

/** Holds the place of the pay buttons until they are built. */
function PaySlot(_props: PayButtonsProps) {
  return <div className="pay-slot" data-slot="pay" />
}

const newCart = (): CartState => ({ clientId: newId(), lines: [] })

/** The cashier's bill screen: find a bottle, tap it, see the cart. Search and catalogue on the left, the bill on the right. */
export default function BillScreen() {
  const { store } = useSession()
  const storeCode = store?.code
  const data = useBillData(storeCode)
  const [cart, dispatch] = useReducer(cartReducer, undefined, newCart)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [notice, setNotice] = useState<string | null>(null)

  const add = useCallback((productId: string) => dispatch({ type: 'add', productId }), [])
  // After a payment the next customer gets an empty cart and a fresh clientId.
  const onPaid = useCallback((_bill: Bill) => dispatch({ type: 'clear', clientId: newId() }), [])

  useScanner((code) => {
    void db.products
      .where('barcode')
      .equals(code)
      .first()
      .then((p) => {
        if (p && data.byId.has(p.id)) add(p.id)
        else setNotice(t('bill.unknownCode', { code }))
      })
  })

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const productsInCart = useMemo(() => cart.lines.map((l) => l.productId).join(','), [cart.lines])
  // Stock for the products in the cart only: the movements table is far too big to read whole.
  const stock = useLiveQuery(async () => {
    const out = new Map<string, number>()
    if (!storeCode || productsInCart === '') return out
    for (const id of productsInCart.split(',')) {
      const rows = await db.movements.where('[storeCode+productId]').equals([storeCode, id]).toArray()
      out.set(id, onHand(rows, storeCode, id))
    }
    return out
  }, [storeCode, productsInCart])

  const topProducts = useMemo(
    () => data.top.flatMap((id) => data.byId.get(id) ?? []).slice(0, 12),
    [data.top, data.byId],
  )

  const tiles = useMemo(() => {
    const found = searchProducts(query, data.products, data.rank)
    const shown: Product[] = tab === 'all' ? found : found.filter((p) => typeOf(p) === tab)
    return brandTiles(shown, data.rank)
  }, [query, tab, data.products, data.rank])

  // Only lines whose product still exists can be priced; the pay buttons get the same cart that was priced.
  const billable = useMemo<CartState>(
    () => ({ ...cart, lines: cart.lines.filter((l) => data.byId.has(l.productId)) }),
    [cart, data.byId],
  )
  const priced = useMemo(
    () => priceCart(billable, data.byId, data.mrpOf, data.offers, data.istDay),
    [billable, data.byId, data.mrpOf, data.offers, data.istDay],
  )

  const clearSearch = (): void => {
    setQuery('')
    setTab('all')
  }

  return (
    <div className="bill-screen">
      <div className="bill-left">
        <SearchBox value={query} onChange={setQuery} />
        {notice !== null && (
          <p className="bill-notice" role="status">
            {notice}
          </p>
        )}
        <TopTiles products={topProducts} mrpOf={data.mrpOf} onAdd={add} />
        <TypeTabs tab={tab} onChange={setTab} />
        <CatalogueGrid tiles={tiles} onAdd={add} onClear={clearSearch} />
      </div>
      <aside className="bill-right">
        <Cart priced={priced} stock={stock} dispatch={dispatch} />
        <div className="customer-slot" data-slot="customer" />
        <p className="bill-total">{t('total', { amount: formatINR(priced.net) })}</p>
        <PaySlot priced={priced} cart={billable} onPaid={onPaid} />
      </aside>
    </div>
  )
}
