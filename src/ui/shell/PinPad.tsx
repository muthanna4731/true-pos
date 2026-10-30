import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

const PIN_LENGTH = 4

/** Big-key PIN entry. Calls `onSubmit` with the 4 digits; it resolves false for a wrong PIN, which clears the entry. */
export default function PinPad({ onSubmit }: { onSubmit: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const press = (digit: string): void => {
    if (busy.current) return
    setWrong(false)
    setFailed(false)
    const next = pin + digit
    if (next.length < PIN_LENGTH) {
      setPin(next)
      return
    }
    setPin(next)
    busy.current = true
    onSubmit(next)
      .then(
        (ok) => {
          if (ok || !alive.current) return
          setWrong(true)
          setPin('')
        },
        () => {
          if (!alive.current) return
          setFailed(true)
          setPin('')
        },
      )
      .finally(() => {
        busy.current = false
      })
  }

  const erase = (): void => {
    if (busy.current) return
    setWrong(false)
    setPin((p) => p.slice(0, -1))
  }

  // Typing on a keyboard works too (the demo runs on laptops).
  const latest = useRef({ press, erase })
  latest.current = { press, erase }
  useEffect(() => {
    let lastKeyAt = 0
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Keys arriving < 35 ms apart are a barcode scanner, not a person: don't type a scan into the PIN.
      const now = Date.now()
      const tooFast = now - lastKeyAt < 35
      lastKeyAt = now
      if (tooFast) return
      if (/^[0-9]$/.test(e.key)) latest.current.press(e.key)
      else if (e.key === 'Backspace') latest.current.erase()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="pinpad">
      <div className="pin-dots" aria-label={t('login.enterPin')}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < pin.length ? 'pin-dot filled' : 'pin-dot'} />
        ))}
      </div>
      <p className="pin-wrong" role="alert">
        {wrong ? t('login.wrongPin') : failed ? t('login.error') : ''}
      </p>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="pin-key" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" className="pin-key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pin-key" onClick={erase} aria-label={t('login.delete')}>
          ⌫
        </button>
      </div>
    </div>
  )
}
