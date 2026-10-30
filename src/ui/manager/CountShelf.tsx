import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db } from '../../db/db'
import { saveCount } from '../../db/stockOps'
import { typeOf } from '../../domain/productType'
import { searchProducts } from '../../domain/search'
import { onHand } from '../../domain/stock'
import { t } from '../../i18n'
import TypeTabs, { type Tab } from '../bill/TypeTabs'
import { useSession } from '../shell/session'
import PageHeader from './PageHeader'

/** Rows shown at once. A type has hundreds of bottles; searching narrows them. */
const MAX_ROWS = 60
const NO_RANK = new Map<string, number>()

const toCount = (text: string): number | null => {
  if (text.trim() === '') return null
  const n = Number(text)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** "3 bottles short", "1 bottle extra" or "Matches ✓". */
function diffText(diff: number): string {
  if (diff === 0) return t('close.matches')
  const n = Math.abs(diff)
  if (diff < 0) return n === 1 ? t('count.shortOne') : t('count.shortMany', { n })
  return n === 1 ? t('count.extraOne') : t('count.extraMany', { n })
}

/** Pick a type or search, type what is on the shelf, see the difference, then [Save count]. */
export default function CountShelf() {
  const { store, user } = useSession()
  const code = store?.code
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)

  const products = useLiveQuery(() => db.products.toArray(), [])
  const picking = tab !== 'all' || query.trim() !== ''
  const shown = useMemo(() => {
    if (!products || !picking) return []
    const found = searchProducts(query, products, NO_RANK)
    return (tab === 'all' ? found : found.filter((p) => typeOf(p) === tab)).slice(0, MAX_ROWS)
  }, [products, picking, query, tab])

  // What the ledger says is on the shelf, for the rows on screen only.
  const ids = shown.map((p) => p.id).join(',')
  const system = useLiveQuery(async () => {
    const out = new Map<string, number>()
    if (!code) return out
    for (const id of ids === '' ? [] : ids.split(',')) {
      out.set(id, onHand(await db.movements.where('[storeCode+productId]').equals([code, id]).toArray(), code, id))
    }
    return out
  }, [code, ids])

  const entered = Object.entries(typed).flatMap(([productId, text]) => {
    const counted = toCount(text)
    return counted === null ? [] : [{ productId, counted }]
  })

  const save = async (): Promise<void> => {
    if (busy.current || !code || !user || entered.length === 0) return // a double tap saves once
    busy.current = true
    setFailed(false)
    try {
      await saveCount(code, entered, user.id)
      setTyped({})
      setSaved(true)
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
    }
  }

  return (
    <>
      <PageHeader title={t('mgr.countShelf')} />
      {saved && (
        <p className="notice" role="status">
          {t('count.saved')}
        </p>
      )}
      <input
        type="text"
        className="search-box"
        aria-label={t('count.search')}
        placeholder={t('count.search')}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      <TypeTabs tab={tab} onChange={setTab} />

      {!picking && <p className="empty">{t('count.hint')}</p>}
      {picking && products && shown.length === 0 && <p className="empty">{t('noMatch')}</p>}
      <ul className="count-lines">
        {shown.map((p) => {
          const text = typed[p.id] ?? ''
          const counted = toCount(text)
          const have = system?.get(p.id)
          return (
            <li key={p.id} className="count-line">
              <strong>{p.shortName}</strong>
              <span>{have === undefined ? '…' : t('count.system', { n: have })}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={t('stock.counted', { name: p.shortName })}
                value={text}
                onChange={(e) => {
                  setSaved(false)
                  setTyped((s) => ({ ...s, [p.id]: e.target.value }))
                }}
              />
              <span className={have !== undefined && counted !== null && counted !== have ? 'diff off' : 'diff'}>
                {counted !== null && have !== undefined ? diffText(counted - have) : ''}
              </span>
            </li>
          )
        })}
      </ul>
      {failed && (
        <p className="pay-error" role="alert">
          {t('count.failed')}
        </p>
      )}
      {entered.length > 0 && (
        <button type="button" className="pay-primary save-count" onClick={() => void save()}>
          {t('count.save')}
        </button>
      )}
    </>
  )
}
