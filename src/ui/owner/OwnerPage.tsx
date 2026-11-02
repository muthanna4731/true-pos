import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../db/db'
import { istDayRange } from '../../db/dayData'
import { formatINR } from '../../domain/money'
import { chainMonthToDate, nightlySummaryText, shopSummaries } from '../../domain/owner'
import { priceRowsInForce } from '../../domain/prices'
import { discountsReport, exciseLitreStatement, valuation } from '../../domain/reports'
import { clock, formatDate, istDate, istDayStart } from '../../domain/time'
import { generateTodos } from '../../domain/todos'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { downloadCsv, type Column } from '../common/ReportTable'
import { errorText, guarded } from '../office/shared'
import Offers from './Offers'

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** Everything the page shows for one IST day, read in one pass. */
async function load(day: string) {
  const monthStart = istDayStart(`${day.slice(0, 8)}01`)
  const dayEnd = istDayRange(day)[1]
  const nowIso = clock.now()
  const [stores, movements, shifts, dayCloses] = await Promise.all([db.stores.toArray(), db.movements.toArray(), db.shifts.toArray(), db.dayCloses.toArray()])
  const bills = (await Promise.all(stores.map((s) => db.bills.where('[storeCode+at]').between([s.code, monthStart], [s.code, dayEnd], true, false).toArray()))).flat()
  // Payments only for the day's bills: the month's are only needed for the chain total, which needs no payment split.
  const numbers = bills.filter((b) => b.status === 'paid' && istDate(b.at) === day).map((b) => b.number)
  const payments = await db.payments.where('billNumber').anyOf(numbers).toArray()
  const [products, grns, transfers, counts, claims] = await Promise.all([db.products.toArray(), db.grns.toArray(), db.transfers.toArray(), db.counts.toArray(), db.claims.toArray()])
  const todos = generateTodos({ stores, products, movements, grns, transfers, counts, dayCloses, bills, claims, nowIso })
  return { day, stores, bills, payments, rows: shopSummaries({ stores, bills, payments, shifts, dayCloses, todos, movements, istDay: day, nowIso }), chain: chainMonthToDate(bills, day) }
}

/** The owner's page: every shop on one screen, the chain total, downloads, [Push new prices], offers, and the nightly summary preview. */
export default function OwnerPage() {
  useLang()
  const navigate = useNavigate()
  const busy = useRef(false)
  const today = istDate(clock.now())
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Before the first bill of the day is rung, the page shows last night, so it is never a wall of zeros.
  const data = useLiveQuery(async () => {
    if (picked) return load(picked)
    const [start, end] = istDayRange(today)
    const codes = (await db.stores.toArray()).map((s) => s.code)
    const rung = (await Promise.all(codes.map((c) => db.bills.where('[storeCode+at]').between([c, start], [c, end], true, false).filter((b) => b.status === 'paid').count()))).reduce((a, b) => a + b, 0)
    return load(rung > 0 ? today : addDays(today, -1))
  }, [picked, today])
  if (!data) return null
  const { rows, chain, day } = data
  const text = nightlySummaryText(day, rows)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const monthStart = `${day.slice(0, 8)}01`
  // A failed download says so; the next successful one clears it.
  const download = async (work: () => Promise<void>) => {
    const code = await guarded(busy, work)
    if (code !== 'busy') setError(code)
  }
  const priced = async () => priceRowsInForce(await db.prices.toArray(), day)

  const excise = () =>
    download(async () => {
      const [products, movements, prices] = await Promise.all([db.products.toArray(), db.movements.toArray(), priced()])
      const name = new Map(products.map((p) => [p.id, p.shortName || p.description]))
      const purchase = (id: string) => prices.get(id)?.purchase ?? 0
      const qla = (k: string, label: string): Column[] => [
        { key: `${k}Q`, label: `${label} ${t('del.qty')}`, kind: 'number' },
        { key: `${k}L`, label: `${label} ${t('rep.litres')}`, kind: 'litres' },
        { key: `${k}A`, label: `${label} ₹`, kind: 'money' },
      ]
      const out = data.stores.flatMap((s) =>
        exciseLitreStatement(movements, products, purchase, s.code, monthStart, day).map((r) => ({
          shop: s.name,
          product: name.get(r.productId) ?? r.productId,
          ...Object.fromEntries((['opening', 'received', 'issued', 'closing'] as const).flatMap((k) => [[`${k}Q`, r[k].qty], [`${k}L`, r[k].litres], [`${k}A`, r[k].amount]])),
        })),
      )
      downloadCsv(t('rep.exciseTitle'), [{ key: 'shop', label: t('owner.shop') }, { key: 'product', label: t('del.product') }, ...qla('opening', t('office.opening')), ...qla('received', t('office.received')), ...qla('issued', t('office.issued')), ...qla('closing', t('office.closing'))], out)
    })

  const stockValue = () =>
    download(async () => {
      const [products, movements, prices] = await Promise.all([db.products.toArray(), db.movements.toArray(), priced()])
      const name = new Map(products.map((p) => [p.id, p.shortName || p.description]))
      const landed = (id: string) => (prices.get(id)?.purchase ?? 0) + (prices.get(id)?.aroed ?? 0)
      const mrp = (id: string) => prices.get(id)?.mrp ?? 0
      const out = data.stores.flatMap((s) => valuation(movements, products, landed, mrp, s.code, day).map((r) => ({ ...r, shop: s.name, product: name.get(r.productId) ?? r.productId })))
      downloadCsv(
        t('rep.valuationTitle'),
        [
          { key: 'shop', label: t('owner.shop') },
          { key: 'product', label: t('del.product') },
          { key: 'opening', label: t('office.opening'), kind: 'number' },
          { key: 'openingValue', label: `${t('office.opening')} ₹`, kind: 'money' },
          { key: 'returns', label: t('owner.returns'), kind: 'number' },
          { key: 'returnsValue', label: `${t('owner.returns')} ₹`, kind: 'money' },
          { key: 'sales', label: t('stock.sales'), kind: 'number' },
          { key: 'salesCost', label: `${t('stock.sales')} ₹`, kind: 'money' },
          { key: 'closing', label: t('office.closing'), kind: 'number' },
          { key: 'closingValue', label: `${t('office.closing')} ₹`, kind: 'money' },
          { key: 'mrpAmount', label: t('owner.mrpAmount'), kind: 'money' },
        ],
        out,
      )
    })

  const discounts = () =>
    download(async () => {
      const [products, offers, lines] = await Promise.all([db.products.toArray(), db.offers.toArray(), db.billLines.where('billNumber').anyOf(data.bills.map((b) => b.number)).toArray()])
      downloadCsv(
        t('owner.discountsTitle'),
        [
          { key: 'brand', label: t('owner.brand') },
          { key: 'offerCode', label: t('owner.offer') },
          { key: 'product', label: t('del.product') },
          { key: 'billNumber', label: t('owner.bill') },
          { key: 'qty', label: t('del.qty'), kind: 'number' },
          { key: 'freeQty', label: t('owner.freeBottles'), kind: 'number' },
          { key: 'discount', label: t('owner.discount'), kind: 'money' },
        ],
        discountsReport(lines, data.bills, offers, products, monthStart, day),
      )
    })

  return (
    <div className="owner-page">
      <label>
        {t('owner.day')} <input type="date" value={day} max={today} onChange={(e) => e.target.value && setPicked(e.target.value)} />
      </label>

      <section className="owner-shops">
        {rows.map((r) => (
          <article key={r.storeCode} className="owner-shop">
            <h2>{r.name}</h2>
            <p className="owner-net">{formatINR(r.net)}</p>
            <p>
              {t('owner.bills')}: {r.bills}
            </p>
            <p>
              {t('owner.cash')} {formatINR(r.byMode.cash)} · {t('owner.upi')} {formatINR(r.byMode.upi)} · {t('owner.card')} {formatINR(r.byMode.card)}
            </p>
            <p>
              {t('owner.cashShort')}: {formatINR(r.cashShort)}
            </p>
            <p>
              {t('owner.lowStock')}: {r.lowStock} · {t('owner.deliveryShort')}: {r.deliveryShort}
            </p>
            <p className={r.closed ? 'ok' : 'warn'}>{r.closed ? t('owner.closed') : t('owner.notClosed')}</p>
          </article>
        ))}
      </section>

      <section className="owner-chain">
        <h2>{t('owner.chainMtd')}</h2>
        <p className="owner-net">{formatINR(chain)}</p>
      </section>

      <section className="owner-downloads">
        <h2>{t('owner.downloads')}</h2>
        <button type="button" onClick={excise}>
          {t('owner.dlExcise')}
        </button>
        <button type="button" onClick={stockValue}>
          {t('owner.dlValuation')}
        </button>
        <button type="button" onClick={discounts}>
          {t('owner.dlDiscounts')}
        </button>
        <button type="button" onClick={() => navigate('/owner/prices')}>
          {t('owner.pushPrices')}
        </button>
        {error && <p role="alert">{errorText(error)}</p>}
      </section>

      <Offers />

      <section className="owner-preview">
        <h2>{t('owner.preview')}</h2>
        <p className="muted">{formatDate(istDayStart(day))}</p>
        <pre aria-label={t('owner.preview')}>{text}</pre>
        <button type="button" onClick={copy}>
          {copied ? t('owner.copied') : t('owner.copy')}
        </button>
      </section>
    </div>
  )
}
