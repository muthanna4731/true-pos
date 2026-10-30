import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { flushOutbox, pendingCount } from '../../db/outbox'
import { syncState } from './syncState'

/** Top-right badge: online or offline, how many bills wait, and a problem notice if sending fails. */
export default function SyncBadge() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [error, setError] = useState<string | undefined>(undefined)
  const pending = useLiveQuery(pendingCount, [], 0)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    if (!online) return
    let alive = true
    flushOutbox(true).then(
      () => alive && setError(undefined),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : 'sync failed'),
    )
    return () => {
      alive = false
    }
  }, [online, pending])

  const { tone, text } = syncState(online, pending, error)
  return (
    <span className={`sync-badge sync-${tone}`} role="status">
      {text}
    </span>
  )
}
