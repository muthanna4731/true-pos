import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { loadReports } from '../../db/ownerData'
import { formatINR, formatINRCompact } from '../../domain/money'
import { brandSales, monthSales, offerImpact } from '../../domain/owner'
import { discountsReport } from '../../domain/reports'
import { clock, formatDate, istDate, istDayStart } from '../../domain/time'
import type { Offer } from '../../domain/types'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { downloadExcise, downloadInvoices, downloadPriceList } from './downloads'
import { useOwner } from './ownerContext'
import { Chevron, Empty, NameRow, Section, SubPage, Totals } from './parts'
import { useDownload } from './useDownload'

const BRANDS_SHOWN = 5

const ICON = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** `01–11 Aug`: the month so far, in the header. */
function monthRange(day: string): string {
  const [, month] = formatDate(istDayStart(day)).split(' ')
  return `01–${day.slice(8)} ${month}`
}

/** Reports (under More): the month's settlement, brand-wise sales, offers running, and links to the full CSV reports. */
export default function Reports() {
  useLang()
  const { scope, scopeName } = useOwner()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadReports(scope), [scope, today])
  const download = useDownload()

  const view = useMemo(() => {
    if (!data || data.scope !== scope) return null
    const month = monthSales(data.bills, scope, data.day)
    const monthStart = `${data.day.slice(0, 8)}01`
    const brands = brandSales(data.bills, data.lines, data.products, scope, monthStart, data.day)
    const impact = offerImpact(discountsReport(data.lines, data.bills, data.offers, data.products, monthStart, data.day))
    return { month, brands, impact }
  }, [data, scope])

  if (!data || !view) return <SubPage title={t('ow.reports')} sub={scopeName} picker />
  const { month, brands, impact } = view
  const top = brands[0]?.amount ?? 0
  const running = data.offers.filter((o) => o.from <= data.day && data.day <= o.to)
  const target = (o: Offer): string => (o.type === 'store' ? (data.products.get(o.productId ?? '')?.shortName ?? o.productId ?? '') : (o.brand ?? ''))

  const links = [
    { name: t('ow.stockStatement'), sub: t('ow.stockStatementSub'), run: () => downloadExcise(data.day), icon: <path d="M4 4h16v16H4zM4 9h16M9 9v11" /> },
    { name: t('ow.invoiceList'), sub: t('ow.invoiceListSub'), run: () => downloadInvoices(data.day), icon: <path d="M3 6h18M3 12h18M3 18h12" /> },
    { name: t('ow.priceList'), sub: t('ow.priceListSub'), run: () => downloadPriceList(data.day), icon: <path d="M12 3v18M5 8h14M5 16h14" /> },
  ]

  return (
    <SubPage title={t('ow.reports')} sub={`${scopeName} · ${monthRange(data.day)}`} picker>
      <Totals
        items={[
          { label: t('ow.storeTotal'), value: formatINRCompact(month.net), full: formatINR(month.net) },
          { label: t('ow.billsLabel'), value: new Intl.NumberFormat('en-IN').format(month.bills) },
          { label: t('ow.discountLabel'), value: formatINRCompact(month.discount), full: formatINR(month.discount) },
        ]}
      />

      <Section title={t('ow.brandSales')} />
      <div className="ow-list">
        {brands.length === 0 && <Empty>{t('ow.noTop')}</Empty>}
        {brands.slice(0, BRANDS_SHOWN).map((b) => (
          <div className="ow-brandbar" key={b.brand}>
            <div className="ow-bhead">
              <span className="ow-bname">{b.brand.toLowerCase()}</span>
              <span className="ow-bamt">{formatINR(b.amount)}</span>
            </div>
            <div className="ow-meter">
              <i style={{ width: `${top === 0 ? 0 : Math.max(2, Math.round((b.amount / top) * 100))}%` }} />
            </div>
            <div className="ow-bqty">{t('ow.unitsN', { n: new Intl.NumberFormat('en-IN').format(b.units) })}</div>
          </div>
        ))}
      </div>

      <Section title={t('ow.offersRunning')} />
      <div className="ow-list">
        {running.length === 0 && <Empty>{t('ow.noneRunning')}</Empty>}
        {running.map((o) => (
          <NameRow key={o.code} name={target(o)} sub={t((impact.get(o.code)?.bills ?? 0) === 1 ? 'ow.oneBill' : 'ow.nBills', { n: impact.get(o.code)?.bills ?? 0 })}>
            <span className="ow-amt">{formatINR(impact.get(o.code)?.discount ?? 0)}</span>
          </NameRow>
        ))}
      </div>

      <Section title={t('ow.fullReports')} />
      {download.error && <p className="ow-error" role="alert">{download.error}</p>}
      <div className="ow-list">
        {links.map((l) => (
          <button key={l.name} type="button" className="ow-rlink" onClick={() => download.run(l.run)}>
            <span className="ow-rico">
              <svg {...ICON} aria-hidden="true">
                {l.icon}
              </svg>
            </span>
            <span className="ow-nm">
              <b>{l.name}</b>
              <span>{l.sub}</span>
            </span>
            <Chevron />
          </button>
        ))}
      </div>
    </SubPage>
  )
}
