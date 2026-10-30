import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import { istDayRange, loadDayTotals } from '../../db/dayData'
import { priceRowsInForce } from '../../domain/prices'
import { dailyLitreStatement, exciseLitreStatement, lossesReport, remittance, valuation } from '../../domain/reports'
import { formatTime, istDate } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { nameOf, nowMinute, shopMovements, ShopSelect } from './shared'

const TABS = ['sales', 'excise', 'remit', 'valuation', 'losses', 'tally'] as const
type Tab = (typeof TABS)[number]
const DAY_MS = 86400000
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/** Reports: sales, excise (sample format), store remittance with transfers, valuation, losses, Tally export stub. */
export default function Reports() {
  useLang()
  const now = nowMinute()
  const today = istDate(now)
  const [tab, setTab] = useState<Tab>('sales')
  const [shop, setShop] = useState('')
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)

  const stores = useLiveQuery(() => db.stores.toArray(), [])
  const code = shop || stores?.find((s) => s.isHub)?.code || ''

  const data = useLiveQuery(async () => {
    if (!code) return undefined
    const [products, prices, movements, losses, bills, tally] = await Promise.all([
      db.products.toArray(),
      db.prices.toArray(),
      shopMovements(code),
      db.losses.toArray(),
      (async () => {
        const [a, b] = [istDayRange(to)[0], istDayRange(to)[1]]
        return db.bills.where('[storeCode+at]').between([code, a], [code, b], true, false).toArray()
      })(),
      (async () => {
        const out = []
        for (let d = from; d <= to && out.length < 31; d = addDays(d, 1)) out.push({ day: d, totals: await loadDayTotals(code, d) })
        return out
      })(),
    ])
    return { products, prices, movements, losses, bills, tally }
  }, [code, from, to])

  const view = useMemo(() => {
    if (!data) return undefined
    const productBy = new Map(data.products.map((p) => [p.id, p]))
    const rows = priceRowsInForce(data.prices, to)
    return { productBy, mrp: (id: string) => rows.get(id)?.mrp ?? 0, purchase: (id: string) => rows.get(id)?.purchase ?? 0, landed: (id: string) => (rows.get(id)?.purchase ?? 0) + (rows.get(id)?.aroed ?? 0) }
  }, [data, to])

  if (!stores || !data || !view) return null
  const { productBy, mrp, purchase, landed } = view
  const asOf = { now }
  const name = (id: string) => nameOf(productBy, id)

  const qla = (key: string, label: string) => [
    { key: `${key}Q`, label: `${label} ${t('del.qty')}`, kind: 'number' as const },
    { key: `${key}L`, label: `${label} ${t('rep.litres')}`, kind: 'litres' as const },
    { key: `${key}A`, label: `${label} ₹`, kind: 'money' as const },
  ]

  return (
    <div className="reports">
      <PageHeader title={t('nav.reports')} backTo="/office" />
      <div className="tabs">
        {TABS.map((k) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {t(`rep.${k}`)}
          </button>
        ))}
      </div>
      <div className="filters">
        <ShopSelect stores={stores} value={code} onChange={setShop} label={t('orders.shop')} />
        <label>
          {t('rep.from')} <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label>
          {t('rep.to')} <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>

      {tab === 'sales' && (
        <>
          <ReportTable
            title={t('rep.dailySales')}
            asOf={asOf}
            columns={[
              { key: 'day', label: t('tr.date'), kind: 'date' },
              { key: 'bills', label: t('rep.bills'), kind: 'number' },
              { key: 'net', label: t('del.net'), kind: 'money' },
              { key: 'cash', label: t('cash'), kind: 'money' },
              { key: 'upi', label: 'UPI', kind: 'money' },
              { key: 'card', label: t('rep.card'), kind: 'money' },
            ]}
            rows={data.tally.map((d) => ({ day: `${d.day}T06:30:00.000Z`, bills: d.totals.bills, net: d.totals.net, ...d.totals.byMode }))}
          />
          <ReportTable
            title={t('rep.billsList', { day: to })}
            asOf={asOf}
            columns={[
              { key: 'number', label: t('rep.bill') },
              { key: 'time', label: t('rep.time') },
              { key: 'net', label: t('del.net'), kind: 'money' },
              { key: 'status', label: t('tr.status') },
            ]}
            rows={data.bills.map((b) => ({ number: b.number, time: formatTime(b.at), net: b.net, status: b.status }))}
          />
        </>
      )}

      {tab === 'excise' && (
        <>
          <p className="badge sample-format">{t('rep.sample')}</p>
          <ReportTable
            title={t('rep.exciseTitle')}
            asOf={asOf}
            columns={[{ key: 'product', label: t('del.product') }, ...qla('opening', t('office.opening')), ...qla('received', t('office.received')), ...qla('issued', t('office.issued')), ...qla('closing', t('office.closing'))]}
            rows={exciseLitreStatement(data.movements, productBy, purchase, code, from, to).map((r) => ({
              product: name(r.productId),
              ...Object.fromEntries((['opening', 'received', 'issued', 'closing'] as const).flatMap((k) => [[`${k}Q`, r[k].qty], [`${k}L`, r[k].litres], [`${k}A`, r[k].amount]])),
            }))}
          />
          <ReportTable
            title={t('rep.dailyLitres', { day: to })}
            asOf={asOf}
            columns={[
              { key: 'group', label: t('office.group') },
              { key: 'opening', label: t('office.opening'), kind: 'litres' },
              { key: 'purchase', label: t('stock.purchases'), kind: 'litres' },
              { key: 'total', label: t('office.total'), kind: 'litres' },
              { key: 'sales', label: t('stock.sales'), kind: 'litres' },
              { key: 'closing', label: t('office.closing'), kind: 'litres' },
            ]}
            rows={dailyLitreStatement(data.movements, productBy, code, to)}
          />
        </>
      )}

      {tab === 'remit' && (
        <ReportTable
          title={t('rep.remitTitle')}
          asOf={asOf}
          columns={[
            { key: 'product', label: t('del.product') },
            ...(['opening', 'purchase', 'transferIn', 'transferOut', 'sales', 'adjust', 'closing'] as const).flatMap((k) => [
              { key: `${k}Qty`, label: `${t(`rep.${k}`)} ${t('del.qty')}`, kind: 'number' as const },
              { key: `${k}Value`, label: `${t(`rep.${k}`)} ₹`, kind: 'money' as const },
            ]),
          ]}
          rows={remittance(data.movements, productBy, mrp, code, from, to).map((r) => ({ ...r, product: name(r.productId) }))}
        />
      )}

      {tab === 'valuation' && (
        <ReportTable
          title={t('rep.valuationTitle')}
          asOf={asOf}
          columns={[
            { key: 'product', label: t('del.product') },
            { key: 'opening', label: t('office.opening'), kind: 'number' },
            { key: 'openingValue', label: `${t('office.opening')} ₹`, kind: 'money' },
            { key: 'sales', label: t('stock.sales'), kind: 'number' },
            { key: 'salesCost', label: `${t('stock.sales')} ₹`, kind: 'money' },
            { key: 'closing', label: t('office.closing'), kind: 'number' },
            { key: 'closingValue', label: `${t('office.closing')} ₹`, kind: 'money' },
            { key: 'mrpAmount', label: t('rep.atMrp'), kind: 'money' },
          ]}
          rows={valuation(data.movements, productBy, landed, mrp, code, to).map((r) => ({ ...r, product: name(r.productId) }))}
        />
      )}

      {tab === 'losses' && (
        <ReportTable
          title={t('loss.report')}
          asOf={asOf}
          columns={[
            { key: 'shop', label: t('orders.shop') },
            { key: 'reason', label: t('loss.reason') },
            { key: 'qty', label: t('del.qty'), kind: 'number' },
            { key: 'litres', label: t('rep.litres'), kind: 'litres' },
          ]}
          rows={lossesReport(data.losses, productBy, to.slice(0, 7)).map((r) => ({ shop: r.storeCode, reason: t(`loss.${r.reason}`), qty: r.qty, litres: r.litres }))}
        />
      )}

      {tab === 'tally' && (
        <>
          <p>{t('rep.tallyNote')}</p>
          <ReportTable
            title={t('rep.tallyTitle')}
            asOf={asOf}
            columns={[
              { key: 'date', label: t('tr.date'), kind: 'date' },
              { key: 'voucher', label: t('rep.voucher') },
              { key: 'ledger', label: t('rep.ledger') },
              { key: 'amount', label: t('del.net'), kind: 'money' },
            ]}
            rows={data.tally.map((d) => ({ date: `${d.day}T06:30:00.000Z`, voucher: 'Sales', ledger: code, amount: d.totals.net }))}
          />
        </>
      )}
    </div>
  )
}
