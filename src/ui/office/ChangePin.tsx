import { useRef, useState } from 'react'
import { changePin } from '../../db/users'
import type { User } from '../../domain/types'
import { t } from '../../i18n'

const FOUR_DIGITS = /^[0-9]{4}$/

/** A new 4-digit PIN for one person, typed twice. Saves through `changePin`, the same hash login checks. */
export default function ChangePin({ who, onSaved, onCancel }: { who: Pick<User, 'id' | 'name'>; onSaved(): void; onCancel(): void }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const save = async (): Promise<void> => {
    if (busy.current) return // a double tap saves once
    if (!FOUR_DIGITS.test(pin)) return setError(t('pin.badFormat'))
    if (pin !== again) return setError(t('pin.mismatch'))
    busy.current = true
    try {
      await changePin(who.id, pin)
      onSaved()
    } catch {
      setError(t('pin.failed'))
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="bill-dialog change-pin"
        role="dialog"
        aria-label={t('pin.title', { name: who.name })}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2>{t('pin.title', { name: who.name })}</h2>
        <label>
          {t('pin.new')}{' '}
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        <label>
          {t('pin.again')}{' '}
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {error && (
          <p className="pay-error" role="alert">
            {error}
          </p>
        )}
        <div className="bill-actions">
          <button type="button" onClick={onCancel}>
            {t('pay.cancel')}
          </button>
          <button type="submit" className="pay-primary">
            {t('pin.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
