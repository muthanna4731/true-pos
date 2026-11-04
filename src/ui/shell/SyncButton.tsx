import { useEffect, useState } from 'react'
import { flushOutbox } from '../../db/outbox'
import { t } from '../../i18n'

type SyncStep = 'idle' | 'busy' | 'done' | 'later'

const LABEL: Record<SyncStep, string> = { idle: 'sync.now', busy: 'sync.busy', done: 'sync.done', later: 'sync.later' }

/** Two curved arrows, drawn in the current text colour. */
function SyncIcon() {
  return (
    <svg className="sync-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3v5h5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 21v-5h-5" />
    </svg>
  )
}

/**
 * [Sync now] beside the sync badge: sends whatever waits in the outbox straight away instead of on the next change.
 * Its label says what happened, then settles back after a moment. `owner` makes it a round icon button for the owner header.
 */
export default function SyncButton({ owner = false }: { owner?: boolean }) {
  const [step, setStep] = useState<SyncStep>('idle')

  useEffect(() => {
    if (step !== 'done' && step !== 'later') return
    const id = setTimeout(() => setStep('idle'), 2500)
    return () => clearTimeout(id)
  }, [step])

  const sync = async (): Promise<void> => {
    if (step === 'busy') return
    const online = navigator.onLine
    setStep('busy')
    try {
      await flushOutbox(online)
      setStep(online ? 'done' : 'later')
    } catch {
      setStep('later')
    }
  }

  const label = t(LABEL[step])
  return (
    <button
      type="button"
      className={`${owner ? 'ow-syncnow' : 'sync-button'} sync-${step}`}
      aria-label={owner ? label : undefined}
      title={owner ? label : undefined}
      aria-busy={step === 'busy'}
      onClick={() => void sync()}
    >
      <SyncIcon />
      {!owner && <span>{label}</span>}
    </button>
  )
}
