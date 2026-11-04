import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { flushOutbox, pendingCount } from '../../db/outbox'
import { subscribeSync, syncStatus } from '../../sync/engine'
import { syncState } from './syncState'

/** Top-right badge: online or offline, how many bills wait, and a problem notice if sending fails. `owner` dresses it in the owner app's palette. */
export default function SyncBadge({ owner = false }: { owner?: boolean }) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [error, setError] = useState<string | undefined>(undefined)
  const pending = useLiveQuery(pendingCount, [], 0)
  // Background syncs (timer, reconnect) report here too, not only the ones this badge starts.
  const engine = useSyncExternalStore(subscribeSync, syncStatus)

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

  const { tone, text } = syncState(online, pending, error ?? (engine.state === 'error' ? engine.error : undefined))
  return (
    <span className={owner ? `ow-syncbadge ${tone}` : `sync-badge sync-${tone}`} role="status">
      {text}
    </span>
  )
}
