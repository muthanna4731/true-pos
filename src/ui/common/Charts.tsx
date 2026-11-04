import type { CSSProperties } from 'react'

/** One figure on a chart: what it is called, its size, and how it reads on screen (₹, bottles…). */
export interface ChartPoint {
  key: string
  label: string
  value: number
  text: string
  /** A shorter label for a tight axis (the day of the month); the full label still shows on hover. */
  axis?: string
}

const share = (value: number, max: number): number => (max <= 0 ? 0 : Math.max(0, value) / max)

/**
 * Columns over time, one series. The last column (the current day) is full strength and the rest a lighter step of the
 * same colour; only it and the highest column carry their value, and every column shows its figure on hover or focus.
 */
export function ColumnChart({ title, points }: { title: string; points: ChartPoint[] }) {
  const max = Math.max(0, ...points.map((p) => p.value))
  const last = points.length - 1
  const peak = points.findIndex((p) => p.value === max && max > 0)
  // Long ranges keep about ten date labels so they never collide.
  const every = points.length <= 14 ? 1 : Math.ceil(points.length / 10)
  return (
    <figure className="chart chart-columns" aria-label={title}>
      <div className="chart-plot" role="list">
        {points.map((p, i) => (
          <div key={p.key} className={i === last ? 'chart-slot current' : 'chart-slot'} role="listitem" tabIndex={0} aria-label={`${p.label}: ${p.text}`}>
            <div className="chart-area">
              <span className="chart-col" style={{ height: `${share(p.value, max) * 100}%` }}>
                {(i === last || i === peak) && <span className="chart-value">{p.text}</span>}
              </span>
              <span className="chart-tip" aria-hidden="true">
                {p.label}
                <b>{p.text}</b>
              </span>
            </div>
            <span className="chart-x" aria-hidden="true">
              {i % every === 0 || i === last ? (p.axis ?? p.label) : ''}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

/** Horizontal bars, one series, longest first: a name, the bar and its value at the tip. `tone` colours the bars. */
export function BarList({ title, items, tone = 'brand' }: { title: string; items: ChartPoint[]; tone?: 'brand' | 'bad' }) {
  const max = Math.max(0, ...items.map((p) => p.value))
  return (
    <ul className={`chart chart-bars tone-${tone}`} aria-label={title}>
      {[...items]
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <li key={p.key}>
            <span className="bar-name">{p.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${share(p.value, max) * 100}%` }} />
            </span>
            <span className="bar-value">{p.text}</span>
          </li>
        ))}
    </ul>
  )
}

/** One whole split into parts (cash, UPI, card), with a key that names each part, its value and its share. */
export function SplitBar({ title, parts }: { title: string; parts: (ChartPoint & { color: string })[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  const pct = (v: number): number => (total === 0 ? 0 : Math.round((Math.max(0, v) * 100) / total))
  return (
    <figure className="chart chart-split" aria-label={title}>
      <div className={total === 0 ? 'split-track is-empty' : 'split-track'} aria-hidden="true">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <i key={p.key} style={{ flexGrow: p.value, background: p.color } as CSSProperties} title={`${p.label}: ${p.text}`} />
          ))}
      </div>
      <ul className="split-keys">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} aria-hidden="true" />
            <span>{p.label}</span>
            <b>{p.text}</b>
            <span className="split-pct">{pct(p.value)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
