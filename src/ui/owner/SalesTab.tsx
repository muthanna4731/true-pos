import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSales } from '../../db/ownerData'
import { formatINR } from '../../domain/money'
import { hourSales, istHourStart, liveFeed, stockMoved, type FeedRow } from '../../domain/owner'
import { clock, formatDate, formatTime, istDate } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { useOwner } from './ownerContext'
import { Empty, LiveCard, NameRow, OwnerHeader, Pill, Section, shortDate } from './parts'

/** The top of the current IST hour, rechecked every 20 seconds, so "this hour" rolls over by itself. */
function useHourStart(): string {
  const [hour, setHour] = useState(() => istHourStart(clock.now()))
  useEffect(() => {
    const id = setInterval(() => setHour(istHourStart(clock.now())), 20000)
    return () => clearInterval(id)
  }, [])
  return hour
}

/**
 * The bill list. The bills on screen when it first drew are the baseline; a bill that arrives after that gets the
 * amber edge once. The parent keys this by shop, so picking another shop starts a new baseline.
 */
function Feed({ rows, showShop, shopName, today }: { rows: FeedRow[]; showShop: boolean; shopName(code: string): string; today: string }) {
  const seen = useRef<Set<string> | null>(null)
  const fresh = useRef(new Set<string>())
  if (seen.current === null) seen.current = new Set(rows.map((r) => r.number))
  else
    for (const r of rows)
      if (!seen.current.has(r.number)) {
        seen.current.add(r.number)
        fresh.current.add(r.number)
      }

  return (
    <div className="ow-list">
      {rows.length === 0 && <Empty>{t('ow.noBills')}</Empty>}
      {rows.map((r) => (
        <div key={r.number} className={fresh.current.has(r.number) ? 'ow-bill fresh' : 'ow-bill'} data-fresh={fresh.current.has(r.number) || undefined}>
          <span className="ow-tm">{formatTime(r.at)}</span>
          <span className="ow-who">
            <b>{r.number}</b>
            <span>
              {istDate(r.at) !== today && `${shortDate(formatDate(r.at))} · `}
              {t(r.items === 1 ? 'ow.oneItem' : 'ow.nItems', { n: r.items })} · {t('ow.counterN', { n: r.counter })}
              {showShop && ` · ${shopName(r.storeCode)}`}
            </span>
          </span>
          <span className="ow-amt">{formatINR(r.net)}</span>
        </div>
      ))}
    </div>
  )
}

/** Sales: what was billed this hour, every bill as it lands, and the stock that moved. */
export default function SalesTab() {
  useLang()
  const { scope, scopeName, stores } = useOwner()
  const hourStart = useHourStart()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadSales(scope, hourStart), [scope, hourStart, today])

  const view = useMemo(() => {
    if (!data || data.scope !== scope) return null
    const hour = hourSales(data.bills, clock.now(), scope)
    const feed = liveFeed(data.bills, data.itemCounts, scope)
    const moved = stockMoved(data.movements, (ref) => data.grnTypes.get(ref), data.day, scope)
    return { hour, feed, moved }
  }, [data, scope])

  const sub = `${scopeName} · ${t(data && data.day !== today ? 'ow.yesterdayWord' : 'ow.todayWord')}`
  if (!data || !view) return <div className="ow-app"><OwnerHeader title={t('ow.tab.sales')} sub={sub} /></div>
  const { hour, feed, moved } = view
  const shopName = (code: string): string => stores.find((s) => s.code === code)?.name ?? code
  const count = (n: number, one: string, many: string): string => t(n === 1 ? one : many, { n })

  const lines: { name: string; sub: string; qty: number; kind: 'ok' | 'low'; sign: string }[] = []
  if (moved.ksbcl.count > 0) lines.push({ name: t('ow.fromKsbcl'), sub: count(moved.ksbcl.count, 'ow.grnOne', 'ow.grnMany'), qty: moved.ksbcl.qty, kind: 'ok', sign: '+' })
  if (moved.other.count > 0) lines.push({ name: t('ow.fromOthers'), sub: count(moved.other.count, 'ow.grnOne', 'ow.grnMany'), qty: moved.other.qty, kind: 'ok', sign: '+' })
  if (moved.transferOut.count > 0) lines.push({ name: t('ow.sentOut'), sub: count(moved.transferOut.count, 'ow.outOne', 'ow.outMany'), qty: moved.transferOut.qty, kind: 'low', sign: '−' })
  if (moved.transferIn.count > 0) lines.push({ name: t('ow.gotIn'), sub: count(moved.transferIn.count, 'ow.inOne', 'ow.inMany'), qty: moved.transferIn.qty, kind: 'ok', sign: '+' })

  return (
    <div className="ow-app">
      <OwnerHeader title={t('ow.tab.sales')} sub={sub} />

      <LiveCard eyebrow={t('ow.billedHour')} newestAt={feed[0]?.at ?? null} paise={hour.net}>
        <div className="ow-beneath">
          <span className="ow-delta">{count(hour.bills, 'ow.oneBill', 'ow.nBills')}</span>
          <span className="ow-ctx">{t('ow.since', { time: formatTime(hour.sinceIso) })}</span>
        </div>
      </LiveCard>

      <Section title={t('ow.everyBill')} />
      <Feed key={scope ?? 'all'} rows={feed} showShop={scope === null} shopName={shopName} today={today} />

      <Section title={t(data.day === today ? 'ow.stockMovedToday' : 'ow.stockMovedYesterday')} />
      <div className="ow-list">
        {lines.length === 0 && <Empty>{t('ow.nothingMoved')}</Empty>}
        {lines.map((l) => (
          <NameRow key={l.name} name={l.name} sub={l.sub}>
            <Pill kind={l.kind}>
              {l.sign}
              {l.qty}
            </Pill>
          </NameRow>
        ))}
      </div>
    </div>
  )
}
