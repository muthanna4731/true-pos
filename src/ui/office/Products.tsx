import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db } from '../../db/db'
import { pushPrices, setShortName } from '../../db/stockOps'
import { rupeesToPaise } from '../../domain/money'
import { priceRowsInForce } from '../../domain/prices'
import { istDate } from '../../domain/time'
import type { Price } from '../../domain/types'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { useSession } from '../shell/session'
import { guarded, nowMinute } from './shared'

type Pending = Omit<Price, 'id' | 'pushedBy'>
const SHOWN = 200
const tomorrow = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)

/** The price list (Price-Listing columns), editable short names, new price rows with an effective date, and the history. */
export default function Products() {
  useLang()
  const { user } = useSession()
  const busy = useRef(false)
  const now = nowMinute()
  const today = istDate(now)
  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [form, setForm] = useState({ mrp: '', purchase: '', aroed: '', cess: '', from: tomorrow(today) })
  const [pending, setPending] = useState<Pending[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const data = useLiveQuery(async () => {
    const [products, prices] = await Promise.all([db.products.toArray(), db.prices.toArray()])
    return { products, prices }
  }, [])
  const inForce = useMemo(() => priceRowsInForce(data?.prices ?? [], today), [data?.prices, today])
  if (!data) return null

  const q = find.trim().toLowerCase()
  const list = (q ? data.products.filter((p) => `${p.shortName} ${p.description} ${p.subcategory}`.toLowerCase().includes(q)) : data.products).slice(0, SHOWN)
  const product = data.products.find((p) => p.id === picked)
  const choose = (id: string) => {
    setPicked(id)
    setName(data.products.find((p) => p.id === id)?.shortName ?? '')
    const cur = inForce.get(id)
    setForm({ mrp: cur ? String(cur.mrp / 100) : '', purchase: cur ? String(cur.purchase / 100) : '', aroed: cur ? String(cur.aroed / 100) : '', cess: cur ? String(cur.cess / 100) : '', from: tomorrow(today) })
  }

  const rows = list.map((p) => {
    const pr = inForce.get(p.id)
    return {
      id: p.id,
      material: p.materialType,
      category: p.category,
      subcategory: p.subcategory,
      description: p.description,
      shortName: p.shortName,
      sizeMl: p.sizeMl,
      pack: p.pack ?? '',
      caseSize: p.caseSize,
      hsn: p.hsn,
      mrp: pr?.mrp,
      purchase: pr?.purchase,
      aroed: pr?.aroed,
      cess: pr?.cess,
      margin: pr ? pr.mrp - pr.purchase - pr.aroed : undefined,
      from: pr ? `${pr.effectiveFrom}T06:30:00.000Z` : '',
    }
  })
  const history = picked ? data.prices.filter((p) => p.productId === picked).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : (b.id ?? 0) - (a.id ?? 0))) : []

  const saveName = async () => {
    if (!picked) return
    const err = await guarded(busy, () => setShortName(picked, name))
    setNotice(err ? t('prod.badName') : t('prod.nameSaved'))
  }
  const addRow = () => {
    const [mrp, purchase, aroed, cess] = [form.mrp, form.purchase, form.aroed || '0', form.cess || '0'].map(Number)
    if (!picked || ![mrp, purchase, aroed, cess].every(Number.isFinite) || mrp <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(form.from)) return setNotice(t('prod.badPrice'))
    setPending((ps) => [...ps.filter((x) => x.productId !== picked), { productId: picked, mrp: rupeesToPaise(mrp), purchase: rupeesToPaise(purchase), aroed: rupeesToPaise(aroed), cess: rupeesToPaise(cess), effectiveFrom: form.from }])
    setNotice(null)
  }
  const push = async () => {
    setSaving(true)
    const rowsToPush = pending
    let n = 0
    const err = await guarded(busy, async () => {
      n = await pushPrices(rowsToPush, user?.id ?? '')
    })
    setSaving(false)
    if (err) return setNotice(t('orders.failed'))
    setPending([])
    setNotice(t('prod.pushed', { n }))
  }

  return (
    <div className="products">
      <PageHeader title={t('nav.products')} backTo="/office" />
      <input aria-label={t('tr.find')} placeholder={t('tr.find')} value={find} onChange={(e) => setFind(e.target.value)} />
      <ReportTable
        title={t('prod.list')}
        asOf={{ now }}
        columns={[
          { key: 'material', label: t('prod.material') },
          { key: 'category', label: t('prod.category') },
          { key: 'subcategory', label: t('prod.subcategory') },
          { key: 'description', label: t('prod.description') },
          { key: 'shortName', label: t('prod.shortName') },
          { key: 'sizeMl', label: t('prod.size'), kind: 'number' },
          { key: 'pack', label: t('prod.pack') },
          { key: 'caseSize', label: t('prod.caseSize'), kind: 'number' },
          { key: 'hsn', label: 'HSN' },
          { key: 'mrp', label: t('tr.mrp'), kind: 'money' },
          { key: 'purchase', label: t('prod.purchase'), kind: 'money' },
          { key: 'aroed', label: 'AROED', kind: 'money' },
          { key: 'cess', label: t('prod.cess'), kind: 'money' },
          { key: 'margin', label: t('prod.margin'), kind: 'money' },
          { key: 'from', label: t('prod.effective'), kind: 'date' },
        ]}
        rows={rows}
        onRowClick={(r) => choose(String(r.id))}
      />
      {product && (
        <section aria-label={product.description}>
          <h2>{product.description}</h2>
          <label>
            {t('prod.shortName')} <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" onClick={() => void saveName()}>
            {t('prod.saveName')}
          </button>
          {([['mrp', t('tr.mrp')], ['purchase', t('prod.purchase')], ['aroed', 'AROED'], ['cess', t('prod.cess')]] as const).map(([k, label]) => (
            <label key={k}>
              {label} (₹) <input type="number" min={0} step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <label>
            {t('prod.effective')} <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </label>
          <button type="button" onClick={addRow}>
            {t('prod.addRow')}
          </button>
          <ReportTable
            title={t('prod.history')}
            asOf={{ now }}
            columns={[
              { key: 'from', label: t('prod.effective'), kind: 'date' },
              { key: 'mrp', label: t('tr.mrp'), kind: 'money' },
              { key: 'purchase', label: t('prod.purchase'), kind: 'money' },
              { key: 'aroed', label: 'AROED', kind: 'money' },
              { key: 'cess', label: t('prod.cess'), kind: 'money' },
              { key: 'by', label: t('prod.by') },
            ]}
            rows={history.map((h) => ({ from: `${h.effectiveFrom}T06:30:00.000Z`, mrp: h.mrp, purchase: h.purchase, aroed: h.aroed, cess: h.cess, by: h.pushedBy }))}
          />
        </section>
      )}
      {pending.length > 0 && (
        <section aria-label={t('prod.pending')}>
          <h2>{t('prod.pending')}</h2>
          <ul>
            {pending.map((p) => (
              <li key={p.productId}>
                {data.products.find((x) => x.id === p.productId)?.shortName} · {t('tr.mrp')} {p.mrp / 100} · {p.effectiveFrom}
              </li>
            ))}
          </ul>
          <button type="button" disabled={saving} onClick={() => void push()}>
            {t('prod.push')}
          </button>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
