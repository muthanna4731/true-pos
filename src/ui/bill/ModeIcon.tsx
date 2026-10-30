import type { PayMode } from '../../domain/types'

/** A small flat picture for a payment mode. Decorative: the words beside it carry the meaning. */
export default function ModeIcon({ mode }: { mode: PayMode }) {
  return (
    <svg className="mode-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      {mode === 'cash' && (
        <>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {mode === 'upi' && (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <path d="M14 14h3v3h-3zM19 19h2v2h-2zM14 20h1M20 14h1" />
        </>
      )}
      {mode === 'card' && (
        <>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </>
      )}
    </svg>
  )
}
