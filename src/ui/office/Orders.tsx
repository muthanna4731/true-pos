import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import { advanceIndent, placeIndent, saveDraftIndent } from '../../db/orders'
import { suggestOrder } from '../../domain/orders'
import { shopLabel } from '../../domain/todos'
import { clock, formatDate } from '../../domain/time'
import type { Indent, Store } from '../../domain/types'
import { t } from '../../i18n'
import PageHeader from '../manager/PageHeader'

const toCases = (text: string): number => {
  const n = Math.floor(Number(text))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** One order in the list: its status, and the one thing to do next. A draft takes its KSBCL indent number here. */
function IndentRow({ indent }: { indent: Indent }) {
  const [number, setNumber] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await action()
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      setError(code === 'bad_indent' ? t('orders.badIndent') : code === 'indent_exists' ? t('orders.indentExists') : t('orders.failed'))
    }
  }

  const cases = indent.lines.reduce((s, l) => s + l.cases, 0)
  return (
    <li className="order-row">
      <strong>{indent.status === 'draft' ? t('orders.draft') : indent.id}</strong>
      <span className={`order-status order-${indent.status}`}>{t(`orders.${indent.status}`)}</span>
      <span>{formatDate(indent.placedAt)}</span>
      <span>{t('orders.lines', { n: indent.lines.length, cases })}</span>
      {indent.status === 'draft' && (
        <>
          <input aria-label={t('orders.indentNo')} placeholder="INDMYH26009468" value={number} onChange={(e) => setNumber(e.target.value)} />
          <button type="button" onClick={() => void run(() => placeIndent(indent.id, number))}>
            {t('orders.place')}
          </button>
        </>
      )}
      {indent.status === 'placed' && (
        <button type="button" onClick={() => void run(() => advanceIndent(indent.id, 'placed'))}>
          {t('orders.markPaid')}
        </button>
      )}
      {indent.status === 'paid' && (
        <button type="button" onClick={() => void run(() => advanceIndent(indent.id, 'paid'))}>
          {t('orders.markDispatched')}
        </button>
      )}
      {error && <p role="alert" className="field-error">{error}</p>}
    </li>
  )
}

/**
 * Orders to KSBCL: the suggested order for a shop (the hub's includes the other shops), quantities that can be
 * changed, [Copy for KSBCL portal], and the list of orders with their status buttons up to Dispatched.
 */
export default function Orders() {
  const [picked, setPicked] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const now = `${clock.now().slice(0, 16)}:00.000Z`

  const data = useLiveQuery(async () => {
    const [stores, products, movements, indents] = await Promise.all([db.stores.toArray(), db.products.toArray(), db.movements.toArray(), db.indents.toArray()])
    return { stores, products, movements, indents }
  }, [])

  const stores: Store[] = data?.stores ?? []
  const shop = stores.find((s) => s.code === picked) ?? stores.find((s) => s.isHub) ?? stores[0]
  const productBy = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data?.products])

  const suggested = useMemo(
    () => (data && shop ? suggestOrder({ movements: data.movements, products: data.products, indents: data.indents, storeCodes: shop.isHub ? data.stores.map((s) => s.code) : [shop.code], nowIso: now }) : []),
    [data, shop, now],
  )

  if (!data || !shop) return null

  const casesOf = (productId: string, suggestion: number): number => (productId in edits ? toCases(edits[productId]) : suggestion)
  const order = suggested.map((l) => ({ productId: l.productId, cases: casesOf(l.productId, l.cases) }))
  const mine = data.indents.filter((i) => i.storeCode === shop.code).sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1))

  const portalText = order
    .filter((l) => l.cases > 0)
    .map((l) => `${productBy.get(l.productId)?.description ?? l.productId}\t${l.cases}`)
    .join('\n')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(portalText)
      setNotice(t('orders.copied'))
    } catch {
      setNotice(t('orders.copyFailed'))
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await saveDraftIndent(shop.code, order)
      setEdits({})
      setNotice(t('orders.saved'))
    } catch (e) {
      setNotice(e instanceof Error && e.message === 'empty_order' ? t('orders.emptyOrder') : t('orders.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="orders">
      <PageHeader title={t('orders.title')} backTo="/office" />
      <label>
        {t('orders.shop')}{' '}
        <select
          value={shop.code}
          onChange={(e) => {
            setPicked(e.target.value)
            setEdits({})
            setNotice(null)
          }}
        >
          {stores.map((s) => (
            <option key={s.code} value={s.code}>
              {shopLabel(s, s.code)} {s.name}
            </option>
          ))}
        </select>
      </label>
      {shop.isHub && <p>{t('orders.hubNote', { shop: shopLabel(shop, shop.code) })}</p>}

      <h2>{t('orders.suggested')}</h2>
      {suggested.length === 0 ? (
        <p>{t('orders.none')}</p>
      ) : (
        <table className="report-table orders-table">
          <thead>
            <tr>
              <th>{t('orders.product')}</th>
              <th className="num">{t('orders.onHand')}</th>
              <th className="num">{t('orders.onOrder')}</th>
              <th className="num">{t('orders.avg')}</th>
              <th className="num">{t('orders.cases')}</th>
            </tr>
          </thead>
          <tbody>
            {suggested.map((l) => {
              const p = productBy.get(l.productId)
              return (
                <tr key={l.productId}>
                  <td>{p?.shortName ?? l.productId}</td>
                  <td className="num">{l.onHand}</td>
                  <td className="num">{l.onOrder}</td>
                  <td className="num">{Math.round(l.avgDaily * 10) / 10}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-label={`${t('orders.cases')} ${p?.shortName ?? l.productId}`}
                      value={edits[l.productId] ?? String(l.cases)}
                      onChange={(e) => setEdits({ ...edits, [l.productId]: e.target.value })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="order-actions">
        <button type="button" disabled={portalText === ''} onClick={() => void copy()}>
          {t('orders.copy')}
        </button>
        <button type="button" disabled={saving || suggested.length === 0} onClick={() => void saveDraft()}>
          {t('orders.saveDraft')}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}

      <h2>{t('orders.list')}</h2>
      {mine.length === 0 ? (
        <p>{t('orders.noOrders')}</p>
      ) : (
        <ul className="order-list">
          {mine.map((i) => (
            <IndentRow key={i.id} indent={i} />
          ))}
        </ul>
      )}
    </div>
  )
}
