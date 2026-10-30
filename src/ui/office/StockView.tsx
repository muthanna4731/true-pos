import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import { avgDailySales, minLevel } from '../../domain/orders'
import { priceInForce } from '../../domain/prices'
import { typeOf, type ProductType } from '../../domain/productType'
import { dailySheet, productHistory } from '../../domain/stock'
import { istDate, istDayStart } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { nameOf, nowMinute, shopMovements, ShopSelect } from './shared'

const DAY_MS = 86400000
const TYPES: ProductType[] = ['beer', 'whisky', 'rum', 'brandy', 'vodka', 'gin', 'wine', 'other']

/** Stock across shops: the Daily Sheet with bottles/cases, filters, and a tap-through product history. */
export default function StockView() {
  useLang()
  const [shop, setShop] = useState('')
  const [unit, setUnit] = useState<'bottles' | 'cases'>('bottles')
  const [type, setType] = useState('')
  const [low, setLow] = useState(false)
  const [slow, setSlow] = useState(false)
  const [expiring, setExpiring] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const now = nowMinute()
  const today = istDate(now)

  const stores = useLiveQuery(() => db.stores.toArray(), [])
  const hub = stores?.find((s) => s.isHub) ?? stores?.[0]
  const code = shop || hub?.code || ''

  const data = useLiveQuery(async () => {
    if (!code) return undefined
    const [products, prices, movements] = await Promise.all([db.products.toArray(), db.prices.toArray(), shopMovements(code)])
    return { products, prices, movements }
  }, [code])

  const view = useMemo(() => {
    if (!data) return undefined
    const productBy = new Map(data.products.map((p) => [p.id, p]))
    const mrps = priceInForce(data.prices, today)
    const sheet = dailySheet(data.movements, productBy, (id) => mrps.get(id) ?? 0, code, today)
    const avg = avgDailySales(data.movements, now)
    const slowSince = new Date(new Date(istDayStart(today)).getTime() - 30 * DAY_MS).toISOString()
    const soldRecently = new Set(data.movements.filter((m) => m.kind === 'sale' && m.at >= slowSince).map((m) => m.productId))
    const horizon = new Date(new Date(istDayStart(today)).getTime() + 30 * DAY_MS).toISOString().slice(0, 10)
    const expiringIds = new Set(data.movements.filter((m) => m.qty > 0 && m.expiresOn && m.expiresOn <= horizon).map((m) => m.productId))
    return { productBy, sheet, avg, soldRecently, expiringIds }
  }, [data, code, today, now])

  if (!stores || !data || !view) return null
  const { productBy, sheet, avg, soldRecently, expiringIds } = view
  const q = (bottles: number, id: string): number => (unit === 'cases' ? bottles / (productBy.get(id)?.caseSize || 1) : bottles)

  const rows = sheet
    .filter((r) => {
      const p = productBy.get(r.productId)!
      if (type && typeOf(p) !== type) return false
      if (low && !(r.closing < minLevel(avg.get(`${code}|${r.productId}`) ?? 0) && avg.has(`${code}|${r.productId}`))) return false
      if (slow && !(r.closing > 0 && !soldRecently.has(r.productId))) return false
      if (expiring && !(p.category === 'BEER' && expiringIds.has(r.productId) && r.closing > 0)) return false
      return true
    })
    .map((r) => ({
      id: r.productId,
      product: nameOf(productBy, r.productId),
      opening: q(r.opening, r.productId),
      purchase: q(r.purchase, r.productId),
      transferIn: q(r.transferIn, r.productId),
      transferOut: q(r.transferOut, r.productId),
      total: q(r.total, r.productId),
      sales: q(r.sales, r.productId),
      closing: q(r.closing, r.productId),
      mrp: r.mrp,
      salesValue: r.salesValue,
    }))

  const history = picked ? productHistory(data.movements, code, picked).slice(0, 200) : []

  return (
    <div className="stock-view">
      <PageHeader title={t('nav.stock')} backTo="/office" />
      <div className="filters">
        <ShopSelect stores={stores} value={code} onChange={(c) => { setShop(c); setPicked(null) }} label={t('orders.shop')} />
        <button type="button" aria-pressed={unit === 'bottles'} onClick={() => setUnit('bottles')}>
          {t('stock.bottles')}
        </button>
        <button type="button" aria-pressed={unit === 'cases'} onClick={() => setUnit('cases')}>
          {t('stock.cases')}
        </button>
        <label>
          {t('stock.type')}{' '}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('stock.allTypes')}</option>
            {TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`type.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {([['low', low, setLow], ['slow', slow, setSlow], ['expiring', expiring, setExpiring]] as const).map(([k, on, set]) => (
          <label key={k}>
            <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {t(`stock.${k}`)}
          </label>
        ))}
      </div>

      <ReportTable
        title={t('stock.sheet')}
        asOf={{ now }}
        columns={[
          { key: 'product', label: t('del.product') },
          { key: 'opening', label: t('office.opening'), kind: 'number' },
          { key: 'purchase', label: t('stock.purchases'), kind: 'number' },
          { key: 'transferIn', label: t('stock.transfersIn'), kind: 'number' },
          { key: 'transferOut', label: t('stock.transfersOut'), kind: 'number' },
          { key: 'total', label: t('office.total'), kind: 'number' },
          { key: 'sales', label: t('stock.sales'), kind: 'number' },
          { key: 'closing', label: t('office.closing'), kind: 'number' },
          { key: 'mrp', label: t('tr.mrp'), kind: 'money' },
          { key: 'salesValue', label: t('stock.salesValue'), kind: 'money' },
        ]}
        rows={rows}
        onRowClick={(r) => setPicked(String(r.id))}
      />

      {picked && (
        <ReportTable
          title={t('stock.history', { name: nameOf(productBy, picked) })}
          asOf={{ now }}
          columns={[
            { key: 'at', label: t('tr.date'), kind: 'date' },
            { key: 'kind', label: t('stock.kind') },
            { key: 'ref', label: t('tr.doc') },
            { key: 'qty', label: t('del.qty'), kind: 'number' },
          ]}
          rows={history.map((m) => ({ at: m.at, kind: t(`kind.${m.kind}`), ref: m.ref, qty: m.qty }))}
        />
      )}
    </div>
  )
}
