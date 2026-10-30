import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db } from '../../db/db'
import { recordLoss } from '../../db/stockOps'
import { lossesReport } from '../../domain/reports'
import { istDate } from '../../domain/time'
import { shopLabel } from '../../domain/todos'
import type { Loss } from '../../domain/types'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { useSession } from '../shell/session'
import { errorText, guarded, LOSS_REASONS, nowMinute, ShopSelect } from './shared'

/** Record a loss (breakage, leakage, shortage, theft, expired) and read the month's losses by shop and reason. */
export default function Losses() {
  useLang()
  const { user } = useSession()
  const busy = useRef(false)
  const now = nowMinute()
  const [shop, setShop] = useState('')
  const [find, setFind] = useState('')
  const [product, setProduct] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<Loss['reason']>('breakage')
  const [note, setNote] = useState('')
  const [month, setMonth] = useState(istDate(now).slice(0, 7))
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const data = useLiveQuery(async () => {
    const [stores, products, losses] = await Promise.all([db.stores.toArray(), db.products.toArray(), db.losses.toArray()])
    return { stores, products, losses }
  }, [])
  const productBy = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data?.products])
  if (!data) return null
  const code = shop || data.stores.find((s) => s.isHub)?.code || data.stores[0]?.code || ''
  const matches = (find.trim() ? data.products.filter((p) => `${p.shortName} ${p.description}`.toLowerCase().includes(find.trim().toLowerCase())) : data.products).slice(0, 50)

  const save = async () => {
    const n = Math.floor(Number(qty))
    if (!product || !Number.isFinite(n) || n <= 0) return setNotice(t('loss.bad'))
    setSaving(true)
    const err = await guarded(busy, () => recordLoss(code, product, n, reason, user?.id ?? '', note))
    setSaving(false)
    if (err) return setNotice(errorText(err))
    setNotice(t('loss.saved'))
    setQty('')
    setNote('')
  }

  const rows = lossesReport(data.losses, productBy, month).map((r) => ({
    shop: shopLabel(data.stores.find((s) => s.code === r.storeCode), r.storeCode),
    reason: t(`loss.${r.reason}`),
    qty: r.qty,
    litres: r.litres,
  }))

  return (
    <div className="losses">
      <PageHeader title={t('nav.losses')} backTo="/office" />
      <section aria-label={t('loss.new')}>
        <ShopSelect stores={data.stores} value={code} onChange={setShop} label={t('orders.shop')} />
        <input aria-label={t('tr.find')} placeholder={t('tr.find')} value={find} onChange={(e) => setFind(e.target.value)} />
        <select aria-label={t('del.product')} value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">{t('tr.pickProduct')}</option>
          {matches.map((p) => (
            <option key={p.id} value={p.id}>
              {p.shortName || p.description}
            </option>
          ))}
        </select>
        <input aria-label={t('del.qty')} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        <select aria-label={t('loss.reason')} value={reason} onChange={(e) => setReason(e.target.value as Loss['reason'])}>
          {LOSS_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`loss.${r}`)}
            </option>
          ))}
        </select>
        <input aria-label={t('loss.note')} placeholder={t('loss.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" disabled={saving} onClick={() => void save()}>
          {t('loss.save')}
        </button>
        {notice && <p role="status">{notice}</p>}
      </section>
      <label>
        {t('loss.month')} <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <ReportTable
        title={t('loss.report')}
        asOf={{ now }}
        columns={[
          { key: 'shop', label: t('orders.shop') },
          { key: 'reason', label: t('loss.reason') },
          { key: 'qty', label: t('del.qty'), kind: 'number' },
          { key: 'litres', label: t('rep.litres'), kind: 'litres' },
        ]}
        rows={rows}
      />
    </div>
  )
}
