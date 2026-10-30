import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../../db/db'
import { receiveGrn } from '../../db/stockOps'
import { lineStatus } from '../../domain/stock'
import type { Grn } from '../../domain/types'
import { t } from '../../i18n'
import { useSession } from '../shell/session'

const toCount = (text: string): number => {
  const n = Math.floor(Number(text))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** "Expected 48 bottles (4 cases)": the invoice's cases are already shown as bottles. */
function expectedText(expected: number, caseSize: number): string {
  if (caseSize > 1 && expected % caseSize === 0) {
    const cases = expected / caseSize
    return cases === 1 ? t('stock.expectedOneCase', { n: expected }) : t('stock.expectedCases', { n: expected, cases })
  }
  return t('stock.expected', { n: expected })
}

function statusText(status: ReturnType<typeof lineStatus>, expected: number, counted: number): string {
  if (status === 'match') return t('close.matches')
  return status === 'short' ? t('stock.short', { n: expected - counted }) : t('stock.extra', { n: counted - expected })
}

/**
 * Count a delivery at the door. Each line starts as invoiced and is coloured by how the count compares:
 * green matches, red short, blue extra. [Breakage] marks broken bottles; [Done] books it.
 */
export default function ReceiveGrn({ grn, onSaved }: { grn: Grn; onSaved(): void }) {
  const { user } = useSession()
  const products = useLiveQuery(() => db.products.bulkGet(grn.lines.map((l) => l.productId)), [grn.id])
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [broken, setBroken] = useState<Record<string, number>>({})
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)

  const countOf = (productId: string, expected: number): number => toCount(typed[productId] ?? String(expected))
  const brokenOf = (productId: string, expected: number): number => Math.min(broken[productId] ?? 0, countOf(productId, expected))

  const done = async (): Promise<void> => {
    if (busy.current || !user) return // a double tap books once
    busy.current = true
    setFailed(false)
    try {
      await receiveGrn(
        grn.id,
        grn.lines.map((l) => ({ productId: l.productId, counted: countOf(l.productId, l.expected), broken: brokenOf(l.productId, l.expected) })),
        user.id,
      )
      onSaved()
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
    }
  }

  if (!products) return null
  return (
    <section className="receive">
      <h2>{t('stock.invoice', { no: grn.invoiceNo })}</h2>
      <ul className="receive-lines">
        {grn.lines.map((line, i) => {
          const id = line.productId
          const name = products[i]?.shortName ?? id
          const counted = countOf(id, line.expected)
          const hurt = brokenOf(id, line.expected)
          const status = lineStatus(line.expected, counted)
          const set = (n: number): void => setTyped((s) => ({ ...s, [id]: String(Math.max(0, n)) }))
          return (
            <li key={id} className={`receive-line status-${status}`} data-status={status}>
              <div className="receive-name">
                <strong>{name}</strong>
                <span>{expectedText(line.expected, products[i]?.caseSize ?? 1)}</span>
              </div>
              <div className="receive-count">
                <button type="button" aria-label={t('bill.less', { name })} onClick={() => set(counted - 1)}>
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label={t('stock.counted', { name })}
                  value={typed[id] ?? String(line.expected)}
                  onChange={(e) => setTyped((s) => ({ ...s, [id]: e.target.value }))}
                />
                <button type="button" aria-label={t('bill.more', { name })} onClick={() => set(counted + 1)}>
                  +
                </button>
              </div>
              <span className="receive-status">{statusText(status, line.expected, counted)}</span>
              <div className="receive-broken">
                <button type="button" onClick={() => setBroken((b) => ({ ...b, [id]: Math.min(hurt + 1, counted) }))}>
                  {t('stock.breakage')}
                </button>
                {hurt > 0 && (
                  <>
                    <span>{t('stock.broken', { n: hurt })}</span>
                    <button type="button" aria-label={t('stock.lessBroken', { name })} onClick={() => setBroken((b) => ({ ...b, [id]: hurt - 1 }))}>
                      −
                    </button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {failed && (
        <p className="pay-error" role="alert">
          {t('stock.failed')}
        </p>
      )}
      <button type="button" className="pay-primary" onClick={() => void done()}>
        {t('bill.done')}
      </button>
    </section>
  )
}
