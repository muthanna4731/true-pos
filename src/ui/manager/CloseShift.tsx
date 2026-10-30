import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../../db/db'
import { closeShift, expectedCash, shiftTakings, type ShiftClose } from '../../db/shifts'
import { cashFromNotes } from '../../domain/cash'
import { formatINR } from '../../domain/money'
import { formatTime } from '../../domain/time'
import type { Paise } from '../../domain/types'
import { t } from '../../i18n'
import { useSession } from '../shell/session'
import NotePad, { coinsToPaise } from './NotePad'

/** "Matches ✓", "₹200 short" or "₹200 over". */
export function diffText(diff: Paise): string {
  if (diff === 0) return t('close.matches')
  return diff < 0 ? t('close.short', { amount: formatINR(-diff) }) : t('close.over', { amount: formatINR(diff) })
}

interface Props {
  /** Close this shift (the cashier's own). Without it the manager picks from the shifts still open at the shop. */
  shiftId?: string
  /** After [Done], with the shift that was closed. */
  onDone(closedShiftId: string): void
  onCancel?(): void
}

/** Count the drawer and close a shift. The cashier's [End shift] and the manager's [Close shift] are this same screen. */
export default function CloseShift({ shiftId, onDone, onCancel }: Props) {
  const [picked, setPicked] = useState<string | undefined>(shiftId)
  if (picked === undefined) return <ShiftPicker onPick={setPicked} />
  return (
    <ShiftCount
      key={picked}
      shiftId={picked}
      onDone={(id) => {
        if (shiftId === undefined) setPicked(undefined)
        onDone(id)
      }}
      onCancel={shiftId === undefined ? () => setPicked(undefined) : onCancel}
    />
  )
}

/** The shifts still open at this shop, one button each. */
function ShiftPicker({ onPick }: { onPick(id: string): void }) {
  const { store } = useSession()
  const code = store?.code
  const open = useLiveQuery(
    async () => {
      if (!code) return undefined
      const shifts = await db.shifts.where('storeCode').equals(code).filter((s) => s.closedAt === undefined).toArray()
      const users = await db.users.bulkGet(shifts.map((s) => s.cashierId))
      return shifts.map((s, i) => ({ shift: s, name: users[i]?.name ?? s.cashierId }))
    },
    [code],
  )
  if (!open) return null
  if (open.length === 0) return <p className="empty">{t('close.noOpen')}</p>
  return (
    <section className="shift-picker">
      <h2>{t('close.pick')}</h2>
      <ul className="shift-list">
        {open.map(({ shift, name }) => (
          <li key={shift.id}>
            <button type="button" className="shift-row" onClick={() => onPick(shift.id)}>
              <span className="shift-name">{name}</span>
              <span>{t('close.opened', { time: formatTime(shift.openedAt) })}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShiftCount({ shiftId, onDone, onCancel }: { shiftId: string; onDone(id: string): void; onCancel?(): void }) {
  const figures = useLiveQuery(async () => ({ expected: await expectedCash(shiftId), takings: await shiftTakings(shiftId) }), [shiftId])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [coins, setCoins] = useState('')
  const [result, setResult] = useState<ShiftClose | null>(null)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)

  if (result) {
    return (
      <section className="shift-result" aria-live="polite">
        <h2>{t('close.closed')}</h2>
        <p className={`close-diff ${result.diff === 0 ? 'ok' : 'off'}`}>{diffText(result.diff)}</p>
        {result.dayLocked && <p className="day-locked">{t('close.dayLocked')}</p>}
        <button type="button" className="pay-primary" onClick={() => onDone(shiftId)}>
          {t('bill.done')}
        </button>
      </section>
    )
  }
  if (!figures) return null

  const counted = cashFromNotes(counts, coinsToPaise(coins))
  const close = async (): Promise<void> => {
    if (busy.current) return // a double tap closes once
    busy.current = true
    setFailed(false)
    try {
      setResult(await closeShift(shiftId, counts, coinsToPaise(coins)))
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
    }
  }

  return (
    <section className="shift-count">
      <h2>{t('close.notes')}</h2>
      <NotePad counts={counts} coins={coins} onNotes={(rupees, n) => setCounts((c) => ({ ...c, [rupees]: n }))} onCoins={setCoins} />
      <div className="shift-figures">
        <p>{t('close.expected', { amount: formatINR(figures.expected) })}</p>
        <p>{t('close.counted', { amount: formatINR(counted) })}</p>
        <p className={`close-diff ${counted === figures.expected ? 'ok' : 'off'}`}>{diffText(counted - figures.expected)}</p>
        <p>{t('close.upi', { amount: formatINR(figures.takings.upi) })}</p>
        <p>{t('close.card', { amount: formatINR(figures.takings.card) })}</p>
      </div>
      {failed && (
        <p className="pay-error" role="alert">
          {t('close.failed')}
        </p>
      )}
      <div className="pay-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t('pay.cancel')}
          </button>
        )}
        <button type="button" className="pay-primary" onClick={() => void close()}>
          {t('close.close')}
        </button>
      </div>
    </section>
  )
}
