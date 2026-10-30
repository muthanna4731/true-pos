import { useState } from 'react'
import { changeNotes, quickTenders } from '../../domain/cash'
import { formatINR } from '../../domain/money'
import type { Paise } from '../../domain/types'
import { t } from '../../i18n'

interface Props {
  total: Paise
  busy: boolean
  /** The bill is paid in cash for its full amount: the drawer takes the total, whatever was handed over. */
  onPay(): void
  onCancel(): void
}

const MAX_DIGITS = 5
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** What the customer handed over, then the change as note pictures. [Exact] pays at once; any other amount waits for [Done]. */
export default function CashDialog({ total, busy, onPay, onCancel }: Props) {
  const [given, setGiven] = useState<Paise | null>(null)
  const [entry, setEntry] = useState('')

  const type = (next: string): void => {
    setEntry(next)
    setGiven(next === '' ? null : Number(next) * 100)
  }
  const change = given === null ? 0 : given - total
  const { notes, coins } = changeNotes(change)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="pay-dialog" role="dialog" aria-label={t('cash')} onClick={(e) => e.stopPropagation()}>
        <p className="pay-amount">{formatINR(total)}</p>
        <div className="tender-buttons">
          {quickTenders(total).map((tender) =>
            tender === 'exact' ? (
              <button key="exact" type="button" className="pay-primary" disabled={busy} onClick={onPay}>
                {t('pay.exact')}
              </button>
            ) : (
              <button
                key={tender}
                type="button"
                onClick={() => {
                  setEntry('')
                  setGiven(tender)
                }}
              >
                {formatINR(tender)}
              </button>
            ),
          )}
        </div>
        <output className="keypad-display">{given === null ? '' : t('pay.given', { amount: formatINR(given) })}</output>
        <div className="keypad-keys">
          {KEYS.map((d) => (
            <button key={d} type="button" onClick={() => type((entry + d).slice(0, MAX_DIGITS))}>
              {d}
            </button>
          ))}
          <button type="button" aria-label={t('login.delete')} onClick={() => type(entry.slice(0, -1))}>
            ⌫
          </button>
          <button type="button" onClick={() => type(entry === '' ? '' : (entry + '0').slice(0, MAX_DIGITS))}>
            0
          </button>
          <button type="button" onClick={() => type(entry === '' ? '' : (entry + '00').slice(0, MAX_DIGITS))}>
            00
          </button>
        </div>
        {given !== null && change >= 0 && (
          <div className="give-back">
            <p className="give-back-amount">{t('pay.giveBack', { amount: formatINR(change) })}</p>
            <div className="notes">
              {notes.map((n) => (
                <span key={n.rupees} className={`note note-${n.rupees}`} role="img" aria-label={t('pay.noteAlt', { rupees: n.rupees })}>
                  <span aria-hidden="true">{n.rupees}</span>
                  {n.count > 1 && <span className="note-count">×{n.count}</span>}
                </span>
              ))}
              {coins > 0 && <span className="coins">{t('pay.coins', { amount: formatINR(coins) })}</span>}
            </div>
          </div>
        )}
        <div className="pay-actions">
          <button type="button" onClick={onCancel}>
            {t('pay.cancel')}
          </button>
          {given !== null && change >= 0 && (
            <button type="button" className="pay-primary" disabled={busy} onClick={onPay}>
              {t('bill.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
