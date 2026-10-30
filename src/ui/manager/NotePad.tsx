import type { Paise } from '../../domain/types'
import { t } from '../../i18n'

const NOTES = [500, 200, 100, 50, 20, 10]

interface Props {
  /** Notes counted so far, by rupee value. */
  counts: Record<number, number>
  /** Coins in whole rupees, as typed. */
  coins: string
  onNotes(rupees: number, count: number): void
  onCoins(text: string): void
}

/** Coins typed in whole rupees, as paise. Anything that is not a whole number counts as nothing. */
export function coinsToPaise(text: string): Paise {
  const n = Number(text)
  return Number.isInteger(n) && n > 0 ? n * 100 : 0
}

/** Tap a note picture to count one more; the − takes one off. Coins are one figure. */
export default function NotePad({ counts, coins, onNotes, onCoins }: Props) {
  return (
    <div className="note-pad">
      {NOTES.map((rupees) => {
        const n = counts[rupees] ?? 0
        return (
          <div key={rupees} className="note-row">
            <button type="button" className={`note note-${rupees}`} aria-label={t('close.addNote', { rupees })} onClick={() => onNotes(rupees, n + 1)}>
              <span aria-hidden="true">₹{rupees}</span>
            </button>
            <span className="note-total" aria-hidden="true">
              ×{n}
            </span>
            {n > 0 && (
              <button type="button" aria-label={t('close.removeNote', { rupees })} onClick={() => onNotes(rupees, n - 1)}>
                −
              </button>
            )}
          </div>
        )
      })}
      <label className="coins-field">
        {t('close.coins')}
        <input type="number" inputMode="numeric" min={0} step={1} value={coins} onChange={(e) => onCoins(e.target.value)} />
      </label>
    </div>
  )
}
