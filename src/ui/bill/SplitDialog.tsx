import { useState } from 'react'
import { validateSplit } from '../../domain/cash'
import { formatINR, rupeesToPaise } from '../../domain/money'
import type { PayMode, Paise } from '../../domain/types'
import { t } from '../../i18n'

interface Props {
  total: Paise
  busy: boolean
  onPay(parts: { mode: PayMode; amount: Paise }[]): void
  onCancel(): void
}

const MODES: PayMode[] = ['cash', 'upi', 'card']
const AMOUNT = /^\d*\.?\d{0,2}$/

const toPaise = (text: string): Paise => (text === '' || text === '.' ? 0 : rupeesToPaise(Number(text)))
const toText = (p: Paise): string => String(p / 100)

/** One amount per payment mode. [Pay] works only when the amounts add up to the total. */
export default function SplitDialog({ total, busy, onPay, onCancel }: Props) {
  const [text, setText] = useState<Record<PayMode, string>>({ cash: '', upi: '', card: '' })

  const parts = MODES.map((mode) => ({ mode, amount: toPaise(text[mode]) })).filter((p) => p.amount > 0)
  const left = total - parts.reduce((s, p) => s + p.amount, 0)
  const valid = validateSplit(total, parts)

  const set = (mode: PayMode, value: string): void => {
    if (AMOUNT.test(value)) setText((prev) => ({ ...prev, [mode]: value }))
  }
  // What is left once the other modes are counted.
  const restFor = (mode: PayMode): Paise => left + toPaise(text[mode])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="pay-dialog" role="dialog" aria-label={t('pay.split')} onClick={(e) => e.stopPropagation()}>
        <p className="pay-amount">{formatINR(total)}</p>
        {MODES.map((mode) => (
          <div key={mode} className="split-row">
            <label>
              <span>{t(mode)}</span>
              <input
                type="text"
                inputMode="decimal"
                value={text[mode]}
                placeholder="₹0"
                onChange={(e) => set(mode, e.target.value)}
              />
            </label>
            {restFor(mode) > 0 && (
              <button type="button" aria-label={t('pay.rest', { mode: t(mode) })} onClick={() => set(mode, toText(restFor(mode)))}>
                {formatINR(restFor(mode))}
              </button>
            )}
          </div>
        ))}
        <p className="split-left">{t('pay.left', { amount: formatINR(left) })}</p>
        <div className="pay-actions">
          <button type="button" onClick={onCancel}>
            {t('pay.cancel')}
          </button>
          <button type="button" className="pay-primary" disabled={!valid || busy} onClick={() => onPay(parts)}>
            {t('pay.pay')}
          </button>
        </div>
      </div>
    </div>
  )
}
