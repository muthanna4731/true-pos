import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../db/db'
import { exciseLitreStatement } from '../../domain/reports'
import { generateTodos } from '../../domain/todos'
import { clock, istDate, istDayStart } from '../../domain/time'
import type { Product, StockMovement } from '../../domain/types'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'

/** Low-stock items shown before [Show all]: one product can be low in several shops, and there can be dozens of products. */
const LOW_SHOWN = 5
const DAY_MS = 86400000

type Group = 'BEER' | 'IML'
interface LitreFigures {
  opening: number
  received: number
  issued: number
  closing: number
}

/** Opening, received, issued and closing litres of every shop together, per excise group, for the 7 IST days up to yesterday. */
function litresByGroup(movements: StockMovement[], products: Product[], storeCodes: string[], nowIso: string): Record<Group, LitreFigures> {
  const todayStart = new Date(istDayStart(istDate(nowIso))).getTime()
  const from = istDate(new Date(todayStart - 7 * DAY_MS).toISOString())
  const to = istDate(new Date(todayStart - 1).toISOString())
  const byStore = new Map<string, StockMovement[]>()
  for (const m of movements) {
    const list = byStore.get(m.storeCode)
    if (list) list.push(m)
    else byStore.set(m.storeCode, [m])
  }
  const zero = (): LitreFigures => ({ opening: 0, received: 0, issued: 0, closing: 0 })
  const out: Record<Group, LitreFigures> = { BEER: zero(), IML: zero() }
  for (const code of storeCodes) {
    // Litres do not depend on cost, so the cost function is 0.
    for (const row of exciseLitreStatement(byStore.get(code) ?? [], products, () => 0, code, from, to)) {
      const g = out[row.group]
      g.opening += row.opening.litres
      g.received += row.received.litres
      g.issued += row.issued.litres
      g.closing += row.closing.litres
    }
  }
  return out
}

/** The office home: what needs doing today, the litres tile, and the tabs to the other screens. */
export default function OfficeHome() {
  const navigate = useNavigate()
  const lang = useLang()
  const [showAllLow, setShowAllLow] = useState(false)
  // To the minute, so the memos below hold between renders.
  const now = `${clock.now().slice(0, 16)}:00.000Z`
  const todayStart = istDayStart(istDate(now))
  const yesterdayStart = istDayStart(istDate(new Date(new Date(todayStart).getTime() - 1).toISOString()))

  const data = useLiveQuery(async () => {
    const stores = await db.stores.toArray()
    const bills = (
      await Promise.all(stores.map((s) => db.bills.where('[storeCode+at]').between([s.code, yesterdayStart], [s.code, todayStart], true, false).toArray()))
    ).flat()
    const [products, movements, grns, transfers, counts, dayCloses, claims] = await Promise.all([
      db.products.toArray(),
      db.movements.toArray(),
      db.grns.toArray(),
      db.transfers.toArray(),
      db.counts.toArray(),
      db.dayCloses.toArray(),
      db.claims.toArray(),
    ])
    return { stores, bills, products, movements, grns, transfers, counts, dayCloses, claims }
  }, [yesterdayStart, todayStart])

  // The text is made in the current language, so a language switch must rebuild it.
  const todos = useMemo(() => (data ? generateTodos({ ...data, nowIso: now }) : undefined), [data, now, lang])
  const litres = useMemo(() => (data ? litresByGroup(data.movements, data.products, data.stores.map((s) => s.code), now) : undefined), [data, now])

  if (!data || !todos || !litres) return null

  const low = todos.filter((x) => x.kind === 'low_stock')
  // Specific problems first: there are few of them, and a long low-stock list would bury them.
  const shown = [...todos.filter((x) => x.kind !== 'low_stock'), ...(showAllLow ? low : low.slice(0, LOW_SHOWN))]
  const total = (f: (g: LitreFigures) => number) => f(litres.BEER) + f(litres.IML)
  const rows = [
    { group: t('office.beer'), ...litres.BEER },
    { group: t('office.iml'), ...litres.IML },
  ]

  return (
    <div className="office-home">
      <header className="office-top">
        <h1>{t('home.office')}</h1>
        <span>{t('office.shops', { n: data.stores.length })}</span>
      </header>

      {todos.length === 0 ? (
        <p className="todo-empty">{t('todo.empty')}</p>
      ) : (
        <ul className="todo-list">
          {shown.map((todo) => (
            <li key={`${todo.kind}|${todo.ref}`} className={`todo todo-${todo.kind}`}>
              <span className="todo-text">{todo.text}</span>
              <button type="button" onClick={() => navigate(todo.action.to)}>
                {todo.action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {low.length > LOW_SHOWN && (
        <button type="button" className="link-button" onClick={() => setShowAllLow(!showAllLow)}>
          {showAllLow ? t('office.lowHide') : t('office.lowShowAll', { n: low.length })}
        </button>
      )}

      <ReportTable
        title={t('office.litres')}
        asOf={{ now }}
        columns={[
          { key: 'group', label: t('office.group') },
          { key: 'opening', label: t('office.opening'), kind: 'litres' },
          { key: 'received', label: t('office.received'), kind: 'litres' },
          { key: 'issued', label: t('office.issued'), kind: 'litres' },
          { key: 'closing', label: t('office.closing'), kind: 'litres' },
        ]}
        rows={rows}
        totals={{ group: t('office.total'), opening: total((g) => g.opening), received: total((g) => g.received), issued: total((g) => g.issued), closing: total((g) => g.closing) }}
      />

      <nav className="office-tabs" aria-label={t('home.office')}>
        <button type="button" onClick={() => navigate('/office/orders')}>
          {t('nav.orders')}
        </button>
        <button type="button" onClick={() => navigate('/office/deliveries')}>
          {t('nav.deliveries')}
        </button>
        <button type="button" onClick={() => navigate('/office/transfers')}>
          {t('nav.transfers')}
        </button>
        <button type="button" onClick={() => navigate('/office/stock')}>
          {t('nav.stock')}
        </button>
        <details className="more-menu">
          <summary>{t('office.more')}</summary>
          {(['losses', 'suppliers', 'products', 'reports', 'shops'] as const).map((p) => (
            <button key={p} type="button" onClick={() => navigate(`/office/${p}`)}>
              {t(`nav.${p}`)}
            </button>
          ))}
        </details>
      </nav>
    </div>
  )
}
