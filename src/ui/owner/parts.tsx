import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ageParts, sparkPath } from '../../domain/owner'
import { formatINR } from '../../domain/money'
import { clock } from '../../domain/time'
import { t } from '../../i18n'
import SyncBadge from '../shell/SyncBadge'
import { useOwner } from './ownerContext'

/* The owner app's building blocks, one per piece of the design: header, live card, stat, section, list rows, badges, sparkline, strips. */

const STROKE = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" strokeWidth="2.5" {...STROKE} aria-hidden="true">
      <path d="M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

export function Chevron({ dir = 'right', size = 15 }: { dir?: 'right' | 'left'; size?: number }) {
  return (
    <svg className="ow-chev" width={size} height={size} viewBox="0 0 24 24" strokeWidth="2.2" {...STROKE} aria-hidden="true">
      <path d={dir === 'right' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </svg>
  )
}

/** The header: optional Kannada line, the serif title, the outlet line (the shop picker) and the avatar. */
export function OwnerHeader({ title, kn, sub, picker = true }: { title: string; kn?: boolean; sub: string; picker?: boolean }) {
  const { openPicker } = useOwner()
  const outlet = (
    <>
      {picker && <PinIcon />}
      {sub}
      {picker && (
        <svg className="ow-caret" width="9" height="9" viewBox="0 0 24 24" strokeWidth="3" {...STROKE} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      )}
    </>
  )
  return (
    <header className="ow-top">
      <div>
        {kn && <span className="ow-kn">ಟ್ರೂ ಸ್ಪಿರಿಟ್ಸ್</span>}
        <div className="ow-wordmark">{title}</div>
        {picker ? (
          <button type="button" className="ow-outlet" aria-haspopup="dialog" aria-label={`${t('ow.pickShop')}: ${sub}`} onClick={openPicker}>
            {outlet}
          </button>
        ) : (
          <span className="ow-outlet">{outlet}</span>
        )}
      </div>
      <div className="ow-top-right">
        <SyncBadge owner />
        <div className="ow-avatar" aria-hidden="true">
          TS
        </div>
      </div>
    </header>
  )
}

/** A sub-screen of More: a way back, then the header without a shop picker (or with one, for the shop-scoped screens). */
export function SubPage({ title, sub, picker = false, children }: { title: string; sub: string; picker?: boolean; children?: ReactNode }) {
  return (
    <div className="ow-app">
      <div className="ow-backrow">
        <Link to="/owner/more" className="ow-back" aria-label={t('ow.back')}>
          <Chevron dir="left" size={14} />
          {t('ow.tab.more')}
        </Link>
      </div>
      <OwnerHeader title={title} sub={sub} picker={picker} />
      {children}
    </div>
  )
}

/** The seconds since the newest bill, ticking every second while the page is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.parse(clock.now()))
  useEffect(() => {
    const id = setInterval(() => setNow(Date.parse(clock.now())), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function LiveChip({ newestAt }: { newestAt: string | null }) {
  const now = useNow()
  if (newestAt === null) return <span className="ow-sync">{t('ow.noBillsYet')}</span>
  const { n, unit } = ageParts(now - Date.parse(newestAt))
  return (
    <span className="ow-sync">
      <i className="ow-dot" />
      {t('ow.live', { age: t(`ow.age.${unit}`, { n }) })}
    </span>
  )
}

/** Rupees as the design's big number: a small grey ₹ and the digits. */
export function Rupees({ paise }: { paise: number }) {
  return (
    <div className="ow-total">
      <span className="ow-rs">₹</span>
      <span className="ow-digits">{formatINR(paise).replace(/^-?₹/, '')}</span>
    </div>
  )
}

/** The signature card with the amber pour orbiting its border. */
export function LiveCard({ eyebrow, newestAt, paise, children }: { eyebrow: string; newestAt: string | null; paise: number; children?: ReactNode }) {
  return (
    <section className="ow-live" aria-label={eyebrow}>
      <div className="ow-live-inner">
        <div className="ow-live-head">
          <span className="ow-eyebrow">{eyebrow}</span>
          <LiveChip newestAt={newestAt} />
        </div>
        <Rupees paise={paise} />
        {children}
      </div>
    </section>
  )
}

export function Section({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="ow-sec">
      <h2>{title}</h2>
      {action}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="ow-stat">
      <span className="ow-eyebrow">{label}</span>
      <div className="ow-val">{value}</div>
      <div className="ow-sub">{sub}</div>
    </div>
  )
}

export function Pill({ kind, children }: { kind: 'low' | 'out' | 'ok' | 'flat'; children: ReactNode }) {
  return <span className={`ow-pill ${kind}`}>{children}</span>
}

export function Spark({ series, trend }: { series: number[]; trend: 'up' | 'flat' | 'down' }) {
  return (
    <svg className={`ow-spark ${trend}`} viewBox="0 0 44 18" fill="none" preserveAspectRatio="none" aria-hidden="true">
      <path d={sparkPath(series)} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Three figures side by side. `full` is the exact amount for a screen reader and a long press. */
export function Totals({ items }: { items: { label: string; value: string; full?: string; color?: string }[] }) {
  return (
    <div className="ow-totals">
      {items.map((i) => (
        <div key={i.label}>
          <span className="ow-eyebrow">{i.label}</span>
          <div className="v" title={i.full} aria-label={i.full ? `${i.label}: ${i.full}` : undefined} style={i.color ? { color: i.color } : undefined}>
            {i.value}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Seg<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: { key: K; label: string }[]; onChange: (key: K) => void }) {
  return (
    <div className="ow-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A name with a small line under it, then whatever sits on the right. */
export function NameRow({ name, sub, rank, children }: { name: string; sub?: string; rank?: number; children?: ReactNode }) {
  return (
    <div className="ow-row">
      {rank !== undefined && <span className="ow-rank">{rank}</span>}
      <span className="ow-nm">
        <b>{name}</b>
        {sub !== undefined && <span>{sub}</span>}
      </span>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ow-empty">{children}</div>
}

/** `11 Aug`, no year: the design's header and row dates. */
export const shortDate = (formatted: string): string => formatted.replace(/ \d{4}$/, '')
