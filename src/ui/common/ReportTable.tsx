import { toCsv } from '../../domain/csv'
import { formatINR } from '../../domain/money'
import { formatDate } from '../../domain/time'
import { t } from '../../i18n'
import AsOf from './AsOf'
import { printAs } from './print'

export type ColumnKind = 'text' | 'date' | 'number' | 'money' | 'litres'
export type Column = { key: string; label: string; kind?: ColumnKind }
type Row = Record<string, unknown>

const count = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** On-screen text of one cell: IST dates, rupees from paise, grouped counts. */
function display(v: unknown, kind: ColumnKind = 'text'): string {
  if (v === null || v === undefined || v === '') return ''
  if (kind === 'date') return formatDate(String(v))
  if (kind === 'money') return formatINR(Number(v))
  if (kind === 'number' || kind === 'litres') return count.format(Number(v))
  return String(v)
}

/** CSV text of one cell: same dates, but plain numbers (rupees, no ₹ or grouping) so Excel can add them. */
function plain(v: unknown, kind: ColumnKind = 'text'): unknown {
  if (v === null || v === undefined || v === '') return ''
  if (kind === 'date') return formatDate(String(v))
  if (kind === 'money') return Number(v) / 100
  return v
}

function downloadCsv(title: string, columns: Column[], rows: Row[]): void {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, plain(r[c.key], c.kind)])))
  // The BOM makes Excel read the file as UTF-8, so ₹ and Kannada survive.
  const blob = new Blob(['\uFEFF', toCsv(data, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // A Kannada title has no ASCII letters, so fall back to a plain name.
  const name = title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report'
  a.download = `${name}.csv`
  a.click()
  // Safari cancels the download if the URL is revoked in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A report: title, as-of stamp, the table with an optional totals row, and [Print] / [Download CSV]. */
export default function ReportTable({
  title,
  columns,
  rows,
  asOf,
  totals,
}: {
  title: string
  columns: Column[]
  rows: Row[]
  asOf: { now: string; dayClose?: { lockedAt: string } }
  totals?: Row
}) {
  const numeric = (c: Column) => c.kind === 'number' || c.kind === 'money' || c.kind === 'litres'
  return (
    <section className="report report-print">
      <header className="report-head">
        <h2>{title}</h2>
        <AsOf now={asOf.now} dayClose={asOf.dayClose} />
        <div className="report-actions">
          <button type="button" onClick={() => printAs('report')}>
            {t('report.print')}
          </button>
          <button type="button" onClick={() => downloadCsv(title, columns, rows)}>
            {t('report.csv')}
          </button>
        </div>
      </header>
      <table className="report-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={numeric(c) ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={numeric(c) ? 'num' : undefined}>
                  {display(r[c.key], c.kind)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={numeric(c) ? 'num' : undefined}>
                  {display(totals[c.key], c.kind)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  )
}
