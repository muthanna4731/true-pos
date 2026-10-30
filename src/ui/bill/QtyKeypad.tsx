import { useState } from 'react'
import { t } from '../../i18n'

interface Props {
  name: string
  current: number
  /** Called with the new quantity as digits are typed (never 0: use the ✕ on the line to remove). */
  onSet(qty: number): void
  onClose(): void
}

const MAX_DIGITS = 3
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** A big number pad for bills like "5 × OC 90". The first digit replaces the quantity; each digit applies at once. */
export default function QtyKeypad({ name, current, onSet, onClose }: Props) {
  const [entry, setEntry] = useState('')

  const change = (next: string): void => {
    setEntry(next)
    if (Number(next) > 0) onSet(Number(next))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="keypad" role="dialog" aria-label={t('bill.quantity')} onClick={(e) => e.stopPropagation()}>
        <p className="keypad-name">{name}</p>
        <output className="keypad-display">{entry === '' ? current : entry}</output>
        <div className="keypad-keys">
          {KEYS.map((d) => (
            <button key={d} type="button" onClick={() => change((entry + d).slice(0, MAX_DIGITS))}>
              {d}
            </button>
          ))}
          <button type="button" aria-label={t('login.delete')} onClick={() => change(entry.slice(0, -1))}>
            ⌫
          </button>
          <button type="button" onClick={() => change(entry === '' ? '' : (entry + '0').slice(0, MAX_DIGITS))}>
            0
          </button>
          <button type="button" className="keypad-done" onClick={onClose}>
            {t('bill.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
