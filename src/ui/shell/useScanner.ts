import { useEffect, useRef } from 'react'

const MAX_GAP_MS = 35
const MIN_LENGTH = 6

/** Set an input's value the way typing would, so React's controlled inputs notice. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Barcode scanner support. A scanner types like a very fast keyboard: keys under 35 ms apart,
 * then Enter. Anything at least 6 characters long that arrives like that is reported as one scan.
 * Works wherever focus is; if an `<input>` has focus, the scanned characters are taken back out of it.
 */
export function useScanner(onScan: (code: string) => void): void {
  const handler = useRef(onScan)
  handler.current = onScan

  useEffect(() => {
    let buffer = ''
    let last = 0

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const now = Date.now()
      const fast = buffer !== '' && now - last < MAX_GAP_MS
      last = now

      if (e.key === 'Enter') {
        const code = fast ? buffer : ''
        buffer = ''
        if (code.length < MIN_LENGTH) return
        e.preventDefault()
        const active = document.activeElement
        if (active instanceof HTMLInputElement && active.value.endsWith(code)) {
          setInputValue(active, active.value.slice(0, -code.length))
        }
        handler.current(code)
        return
      }
      if (e.key.length !== 1) return // Shift, Tab, arrows and the like don't break a scan
      buffer = fast ? buffer + e.key : e.key
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
