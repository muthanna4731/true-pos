import type { ReactNode } from 'react'

/** A very large button for a home screen. 120 px tall. */
export default function BigButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="big-button" onClick={onClick}>
      {children}
    </button>
  )
}
