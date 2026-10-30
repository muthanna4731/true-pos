import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db } from '../../db/db'
import { dispatchTransfer, receiveTransfer } from '../../db/stockOps'
import { newId } from '../../domain/id'
import { avgDailySales, refillSuggestion } from '../../domain/orders'
import { priceRowsInForce } from '../../domain/prices'
import { clock, istDate } from '../../domain/time'
import { shopLabel } from '../../domain/todos'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { useSession } from '../shell/session'
import { errorText, guarded, nameOf, nowMinute, shopMovements, ShopSelect } from './shared'

type Line = { productId: string; qty: number }

/** Transfers between shops: In / Out lists, the ones waiting to be received, a new transfer and a suggested refill. */
export default function Transfers() {
  useLang()
  const { user } = useSession()
  const busy = useRef(false)
  const [tab, setTab] = useState<'in' | 'out'>('out')
  const [shop, setShop] = useState('')
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [permit, setPermit] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [find, setFind] = useState('')
  const [pick, setPick] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const now = nowMinute()
  const by = user?.id ?? ''

  const data = useLiveQuery(async () => {
    const [stores, products, transfers, prices] = await Promise.all([db.stores.toArray(), db.products.toArray(), db.transfers.toArray(), db.prices.toArray()])
    return { stores, products, transfers, prices }
  }, [])

  const productBy = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data?.products])
  if (!data) return null
  const { stores, transfers } = data
  const hub = stores.find((s) => s.isHub) ?? stores[0]
  const fromCode = from || hub?.code || ''
  const toCode = to || stores.find((s) => s.code !== fromCode)?.code || ''
  const label = (code: string) => shopLabel(stores.find((s) => s.code === code), code)
  const rows_in_force = priceRowsInForce(data.prices, istDate(now))

  const mine = transfers.filter((x) => (tab === 'in' ? !shop || x.toStore === shop : !shop || x.fromStore === shop))
  const waiting = transfers.filter((x) => x.status === 'in_transit')
  const rows = mine
    .flatMap((x) => x.lines.map((l) => ({ ...x, ...l })))
    .sort((a, b) => ((a.dispatchedAt ?? '') < (b.dispatchedAt ?? '') ? 1 : -1))
    .slice(0, 300)
    .map((x) => {
      const price = rows_in_force.get(x.productId)
      return {
        doc: x.id,
        date: x.dispatchedAt ?? '',
        product: nameOf(productBy, x.productId),
        qty: x.qty,
        cost: x.qty * (price?.purchase ?? 0),
        mrp: x.qty * (price?.mrp ?? 0),
        from: label(x.fromStore),
        to: label(x.toStore),
        permit: x.permitNo,
        status: t(`tr.${x.status}`),
      }
    })

  const matches = (find.trim() ? data.products.filter((p) => `${p.shortName} ${p.description}`.toLowerCase().includes(find.trim().toLowerCase())) : data.products).slice(0, 50)

  const addLine = () => {
    const n = Math.floor(Number(qty))
    if (!pick || !Number.isFinite(n) || n <= 0) return
    setLines((ls) => [...ls.filter((l) => l.productId !== pick), { productId: pick, qty: n }])
    setQty('')
  }

  const suggest = async () => {
    const movements = (await Promise.all([shopMovements(fromCode), shopMovements(toCode)])).flat()
    setLines(refillSuggestion(toCode, fromCode, movements, avgDailySales(movements, clock.now())))
    setOpen(true)
  }

  const send = async () => {
    setSaving(true)
    const id = `TR-${istDate(clock.now()).replaceAll('-', '')}-${newId().slice(0, 4).toUpperCase()}`
    const code = await guarded(busy, () => dispatchTransfer({ id, fromStore: fromCode, toStore: toCode, permitNo: permit, lines }, by))
    setSaving(false)
    if (code) return setError(errorText(code))
    setError(null)
    setLines([])
    setPermit('')
    setOpen(false)
  }

  const receive = async (id: string) => {
    const code = await guarded(busy, () => receiveTransfer(id, by))
    setError(code ? errorText(code) : null)
  }

  return (
    <div className="transfers">
      <PageHeader title={t('nav.transfers')} backTo="/office" />
      <div className="tabs">
        {(['out', 'in'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {t(`tr.${k}`)}
          </button>
        ))}
        <ShopSelect stores={stores} value={shop} onChange={setShop} label={t('orders.shop')} allLabel={t('tr.allShops')} />
        <button type="button" onClick={() => setOpen(!open)}>
          {t('tr.new')}
        </button>
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}

      {open && (
        <section className="new-transfer" aria-label={t('tr.new')}>
          <ShopSelect stores={stores} value={fromCode} onChange={setFrom} label={t('tr.from')} />
          <ShopSelect stores={stores} value={toCode} onChange={setTo} label={t('tr.to')} />
          <label>
            {t('tr.permit')} <input value={permit} onChange={(e) => setPermit(e.target.value)} placeholder="KA-EX-123456" />
          </label>
          <button type="button" onClick={() => void suggest()}>
            {t('tr.suggest')}
          </button>
          <div>
            <input aria-label={t('tr.find')} placeholder={t('tr.find')} value={find} onChange={(e) => setFind(e.target.value)} />
            <select aria-label={t('del.product')} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('tr.pickProduct')}</option>
              {matches.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName || p.description}
                </option>
              ))}
            </select>
            <input aria-label={t('del.qty')} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            <button type="button" onClick={addLine}>
              {t('tr.addLine')}
            </button>
          </div>
          <ul>
            {lines.map((l) => (
              <li key={l.productId}>
                {nameOf(productBy, l.productId)} × {l.qty}{' '}
                <button type="button" className="link-button" onClick={() => setLines(lines.filter((x) => x !== l))}>
                  {t('tr.remove')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={saving || lines.length === 0 || fromCode === toCode} onClick={() => void send()}>
            {t('tr.dispatch')}
          </button>
        </section>
      )}

      {waiting.length > 0 && (
        <section aria-label={t('tr.waiting')}>
          <h2>{t('tr.waiting')}</h2>
          <ul className="order-list">
            {waiting.map((x) => (
              <li key={x.id} className="order-row">
                <strong>{x.id}</strong>
                <span>
                  {label(x.fromStore)} → {label(x.toStore)}
                </span>
                <span>{t('tr.lineSummary', { n: x.lines.length, q: x.lines.reduce((s, l) => s + l.qty, 0) })}</span>
                <button type="button" onClick={() => void receive(x.id)}>
                  {t('tr.receive')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReportTable
        title={t(tab === 'in' ? 'tr.inTitle' : 'tr.outTitle')}
        asOf={{ now }}
        columns={[
          { key: 'doc', label: t('tr.doc') },
          { key: 'date', label: t('tr.date'), kind: 'date' },
          { key: 'product', label: t('del.product') },
          { key: 'qty', label: t('del.qty'), kind: 'number' },
          { key: 'cost', label: t('tr.cost'), kind: 'money' },
          { key: 'mrp', label: t('tr.mrp'), kind: 'money' },
          { key: 'from', label: t('tr.from') },
          { key: 'to', label: t('tr.to') },
          { key: 'permit', label: t('tr.permit') },
          { key: 'status', label: t('tr.status') },
        ]}
        rows={rows}
      />
    </div>
  )
}
