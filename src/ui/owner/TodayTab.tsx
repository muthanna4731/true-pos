import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { loadToday } from '../../db/ownerData'
import { formatINR, formatINRWhole } from '../../domain/money'
import { dailyUnits, rankProducts, runningOut, salesFigures, trendOf, weekdayDelta } from '../../domain/owner'
import { clock, istDate } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { useOwner } from './ownerContext'
import { Empty, LiveCard, NameRow, OwnerHeader, Pill, Section, Spark, Stat } from './parts'

const RUNNING_SHOWN = 5

/** Today: the live card, bills and discount, the three best sellers, and what is running out. */
export default function TodayTab() {
  useLang()
  const { scope, scopeName, stores } = useOwner()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadToday(scope), [scope, today])

  const view = useMemo(() => {
    if (!data || data.scope !== scope) return null
    const now = clock.now()
    const figures = salesFigures(data.bills, data.lines, data.products, data.day, scope)
    const top = rankProducts(data.bills, data.lines, data.day, scope).map((r) => {
      const series = dailyUnits(data.bills, data.lines, r.productId, data.day, scope)
      return { ...r, series, trend: trendOf(series) }
    })
    return { figures, delta: weekdayDelta(data.bills, data.day, scope, now), top, out: runningOut(data.movements, now, data.day, scope) }
  }, [data, scope])

  const sub = scope === null ? `${scopeName} · ${t('ow.chainTotal')}` : `${scopeName} · ${t(stores.find((s) => s.code === scope)?.isHub ? 'ow.mainOutlet' : 'ow.outlet')}`
  if (!data || !view) return <div className="ow-app"><OwnerHeader title="True Spirits" kn sub={sub} /></div>

  const { figures, delta, top, out } = view
  const productName = (id: string): string => data.products.get(id)?.shortName || data.products.get(id)?.description || id
  const storeName = (code: string): string => stores.find((s) => s.code === code)?.name ?? code
  const share = figures.net === 0 ? 50 : (figures.alc / figures.net) * 100
  const units = (id: string, n: number): string => {
    const can = data.products.get(id)?.pack === 'CAN'
    return t(can ? (n === 1 ? 'ow.can' : 'ow.cans') : n === 1 ? 'ow.bottle' : 'ow.bottles', { n })
  }
  const isToday = data.day === today

  return (
    <div className="ow-app">
      <OwnerHeader title="True Spirits" kn sub={sub} />

      <LiveCard eyebrow={t(isToday ? 'ow.salesToday' : 'ow.salesYesterday')} newestAt={data.newestAt} paise={figures.net}>
        {delta.pct !== null && (
          <div className="ow-beneath">
            <span className={delta.pct < 0 ? 'ow-delta down' : 'ow-delta'}>
              {delta.pct === 0 ? '' : delta.pct < 0 ? '↓ ' : '↑ '}
              {Math.abs(delta.pct)}%
            </span>
            <span className="ow-ctx">{t('ow.vsLast', { day: t(`ow.wd.${delta.weekday}`) })}</span>
          </div>
        )}
        <div className="ow-split">
          <div className={figures.net === 0 ? 'ow-split-bar empty' : 'ow-split-bar'} aria-hidden="true">
            <i className="alc" style={{ flex: `0 0 ${share}%` }} />
            <i className="non" />
          </div>
          <div className="ow-split-keys">
            <span className="ow-key alc">
              <i />
              {t('ow.alcoholic')} <b>{formatINR(figures.alc)}</b>
            </span>
            <span className="ow-key non">
              <i />
              {t('ow.otherSales')} <b>{formatINR(figures.nalc)}</b>
            </span>
          </div>
        </div>
      </LiveCard>

      <div className="ow-pair">
        <Stat label={t('ow.billsLabel')} value={new Intl.NumberFormat('en-IN').format(figures.bills)} sub={t('ow.average', { amount: formatINRWhole(figures.avgBill) })} />
        <Stat label={t('ow.discountLabel')} value={formatINR(figures.discount)} sub={t('ow.ofSales', { pct: (figures.discountTenthPct / 10).toFixed(1) })} />
      </div>

      <Section title={t('ow.topBrands')} action={<Link to="/owner/more/reports">{t('ow.all')}</Link>} />
      <div className="ow-list">
        {top.length === 0 && <Empty>{t('ow.noTop')}</Empty>}
        {top.map((r, i) => (
          <NameRow key={r.productId} rank={i + 1} name={productName(r.productId)} sub={units(r.productId, r.units)}>
            <Spark series={r.series} trend={r.trend} />
            <span className="ow-amt">{formatINR(r.amount)}</span>
          </NameRow>
        ))}
      </div>

      <Section title={t('ow.runningOut')} action={<Link to="/owner/stock">{t('ow.tab.stock')}</Link>} />
      <div className="ow-list">
        {out.length === 0 && <Empty>{t('ow.nothingOut')}</Empty>}
        {out.slice(0, RUNNING_SHOWN).map((r) => (
          <NameRow key={`${r.storeCode}|${r.productId}`} name={productName(r.productId)} sub={scope === null ? storeName(r.storeCode) : t('ow.closingStock')}>
            <Pill kind={r.level}>{t('ow.left', { n: Math.max(0, r.onHand) })}</Pill>
          </NameRow>
        ))}
      </div>
    </div>
  )
}
