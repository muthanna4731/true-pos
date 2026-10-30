import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { db } from './db/db'
import { t } from './i18n'
import { useLang } from './i18n/useLang'
import { AppRoutes } from './routes'
import { loadSeedIfEmpty } from './seed/load'
import { SeedOptionsContext } from './ui/shell/demoPanelState'

type SeedOptions = { seed?: number; days?: number }

let loading: Promise<void> | null = null

/** One seed run at a time, even if React mounts the gate twice. */
function loadOnce(opts: SeedOptions): Promise<void> {
  loading ??= loadSeedIfEmpty(db, opts).finally(() => {
    loading = null
  })
  return loading
}

/** Fills an empty database with the dummy shop data before showing anything (the full seed takes a few seconds). */
export function SeedGate({ seed = {}, children }: { seed?: SeedOptions; children: ReactNode }) {
  useLang()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    loadOnce(seed).then(
      () => alive && setState('ready'),
      () => alive && setState('failed'),
    )
    return () => {
      alive = false
    }
    // The seed options are fixed for the life of the app.
  }, [attempt])

  if (state === 'loading') return <p className="loading">{t('loading')}</p>
  if (state === 'failed') {
    return (
      <p className="loading">
        {t('loadFailed')}{' '}
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          {t('retry')}
        </button>
      </p>
    )
  }
  return <SeedOptionsContext.Provider value={seed}>{children}</SeedOptionsContext.Provider>
}

export default function App() {
  return (
    <SeedGate>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SeedGate>
  )
}
