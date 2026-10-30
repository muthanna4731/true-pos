import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { db } from '../../db/db'
import { cartReducer, priceCart, type Cart as CartState } from '../../domain/cart'
import { formatINR } from '../../domain/money'
import { brandTiles } from '../../domain/sellers'
import { searchProducts } from '../../domain/search'
import { newId } from '../../domain/id'
import { onHand } from '../../domain/stock'
import type { Bill, Product } from '../../domain/types'
import { t } from '../../i18n'
import { getLoyaltyClient, LoyaltyError } from '../../loyalty/client'
import { isMemberCode, normalizeCode } from '../../loyalty/code'
import { useLoyaltyFlag } from '../../loyalty/flags'
import { flushLoyaltyNow } from '../../loyalty/queue'
import { useSession } from '../shell/session'
import { useScanner } from '../shell/useScanner'
import CloseShift from '../manager/CloseShift'
import Cart from './Cart'
import CatalogueGrid from './CatalogueGrid'
import CustomerLine from './CustomerLine'
import PayButtons from './PayButtons'
import SearchBox from './SearchBox'
import TopTiles from './TopTiles'
import TypeTabs, { typeOf, type Tab } from './TypeTabs'
import { useBillData } from './useBillData'
import { usePractice } from './usePractice'

const NOTICE_MS = 4000

const newCart = (): CartState => ({ clientId: newId(), lines: [] })

/** The cashier's bill screen: find a bottle, tap it, see the cart. Search and catalogue on the left, the bill on the right. */
export default function BillScreen() {
  const { store, user, shiftId, logout } = useSession()
  const storeCode = store?.code
  const data = useBillData(storeCode)
  const practice = usePractice()
  const [cart, dispatch] = useReducer(cartReducer, undefined, newCart)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)

  const add = useCallback((productId: string) => dispatch({ type: 'add', productId }), [])
  // After a payment the next customer gets an empty cart and a fresh clientId.
  const onPaid = useCallback((_bill: Bill) => dispatch({ type: 'clear', clientId: newId() }), [])

  // Practice bills never reach loyalty, so on this screen practice mode (or not knowing yet) reads as loyalty off.
  const loyalty = useLoyaltyFlag() && practice === false

  /** Put a member on the bill. Does nothing while loyalty is off. `not_found` when the code is not a member. */
  const attachMember = async (raw: string): Promise<'attached' | 'not_found' | 'off'> => {
    if (!loyalty) return 'off'
    const code = normalizeCode(raw)
    if (!isMemberCode(code)) return 'not_found'
    try {
      await getLoyaltyClient()?.memberInfo(code)
    } catch (e) {
      // Offline, the customer is still added: the earn waits in the queue.
      if (e instanceof LoyaltyError && e.code === 'member_not_found') return 'not_found'
    }
    dispatch({ type: 'member', code })
    return 'attached'
  }

  const typedMember = async (raw: string): Promise<void> => {
    if ((await attachMember(raw)) === 'not_found') setNotice(t('loyalty.notFound'))
  }

  useScanner((code) => {
    // The member QR carries a TS1: prefix: it is never looked up as a bottle.
    if (/^TS1:/i.test(code.trim())) {
      void typedMember(code)
      return
    }
    void db.products
      .where('barcode')
      .equals(code)
      .first()
      .then(async (p) => {
        if (p && data.byId.has(p.id)) add(p.id)
        else if (isMemberCode(code)) {
          // A member code without the prefix: a member when loyalty is on, ignored without a word when it is off.
          if (loyalty && (await attachMember(code)) === 'not_found') setNotice(t('bill.unknownCode', { code }))
        } else setNotice(t('bill.unknownCode', { code }))
      })
  })

  // Switched off while a customer is on the bill: the bill goes on without them.
  const memberOnBill = cart.memberCode
  useEffect(() => {
    if (!loyalty && memberOnBill) dispatch({ type: 'member' })
  }, [loyalty, memberOnBill])

  // Earns and reversals waiting from an offline spell go out when the screen opens and when the network comes back.
  useEffect(() => {
    flushLoyaltyNow()
    window.addEventListener('online', flushLoyaltyNow)
    return () => window.removeEventListener('online', flushLoyaltyNow)
  }, [])

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
      {practice === true && (
        <div className="practice-band" role="status">
          {t('practice.band')}
        </div>
      )}
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
        {loyalty && (
          <div className="customer-slot" data-slot="customer">
            <CustomerLine memberCode={cart.memberCode} onAttach={typedMember} onRemove={() => dispatch({ type: 'member' })} notify={setNotice} />
          </div>
        )}
        <p className="bill-total">{t('total', { amount: formatINR(priced.net) })}</p>
        <PayButtons priced={priced} cart={billable} onPaid={onPaid} />
        {user?.role === 'cashier' && shiftId && (
          <button type="button" className="link-button end-shift" onClick={() => setEnding(true)}>
            {t('endShift')}
          </button>
        )}
      </aside>
      {ending && shiftId && (
        <div className="modal-overlay">
          <div className="close-dialog" role="dialog" aria-label={t('close.title')}>
            <CloseShift shiftId={shiftId} onDone={() => logout()} onCancel={() => setEnding(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
