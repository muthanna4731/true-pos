import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { db } from '../../db/db'
import type { ShopScope } from '../../domain/owner'
import { getLang, t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { OwnerContext, type OwnerState } from './ownerContext'
import { Chevron } from './parts'
import { useOwnerTheme } from './theme'

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const TABS = [
  { to: '/owner', key: 'today', label: 'ow.tab.today', icon: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></> },
  { to: '/owner/stock', key: 'stock', label: 'ow.tab.stock', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></> },
  { to: '/owner/sales', key: 'sales', label: 'ow.tab.sales', icon: <path d="M5 20V9M12 20V4M19 20v-7" /> },
  { to: '/owner/more', key: 'more', label: 'ow.tab.more', icon: <path d="M4 6h16M4 12h16M4 18h10" /> },
] as const

/** The floating capsule: Today, Stock, Sales, More. Each tab is a link. More also covers the screens opened from it. */
function TabBar() {
  const { pathname } = useLocation()
  const onMore = pathname.startsWith('/owner/more') || pathname.startsWith('/owner/prices')
  return (
    <div className="ow-tabwrap">
      <nav className="ow-tabs" aria-label={t('ow.tabs')}>
        {TABS.map((tab) => {
          const on = tab.key === 'more' ? onMore : pathname === tab.to
          return (
            <Link key={tab.key} to={tab.to} className={on ? 'ow-tab on' : 'ow-tab'} aria-current={on ? 'page' : undefined}>
              <svg width="19" height="19" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                {tab.icon}
              </svg>
              {t(tab.label)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/** The list that opens from the outlet line: All shops, then each shop. */
function ShopSheet({ state, close }: { state: OwnerState; close(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const options: { code: ShopScope; name: string }[] = [{ code: null, name: t('ow.allShops') }, ...state.stores.map((s) => ({ code: s.code, name: s.name }))]
  return (
    <div className="ow-sheet-back" onClick={close}>
      <div className="ow-sheet" role="dialog" aria-modal="true" aria-label={t('ow.pickShop')} onClick={(e) => e.stopPropagation()}>
        <h2>{t('ow.pickShop')}</h2>
        <div className="ow-list">
          {options.map((o) => {
            const current = o.code === state.scope
            return (
              <button
                key={o.code ?? 'all'}
                type="button"
                className="ow-rlink"
                aria-current={current}
                onClick={() => {
                  state.setScope(o.code)
                  close()
                }}
              >
                <span className="ow-nm">
                  <b>{o.name}</b>
                </span>
                {current && <Chevron size={15} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The owner's own app: a phone-sized column centred on the page, a floating tab bar, and the shop picked in the
 * outlet line (All shops to start), which every tab follows. Day or night is set here, on the root.
 */
export default function OwnerApp() {
  useLang()
  const stores = useLiveQuery(() => db.stores.toArray(), [])
  const [scope, setScope] = useState<ShopScope>(null)
  const [picking, setPicking] = useState(false)
  const { theme, pick } = useOwnerTheme()
  const lang = getLang()

  const state = useMemo<OwnerState | null>(
    () =>
      stores ? {
        stores,
        scope,
        setScope,
        scopeName: scope === null ? t('ow.allShops') : (stores.find((s) => s.code === scope)?.name ?? scope),
        openPicker: () => setPicking(true),
        theme,
        pickTheme: pick,
      } : null,
    // `pick` is stable enough: it only sets state and storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stores, scope, theme, lang],
  )

  return (
    <div className="owner-app" data-theme={theme}>
      <div className="ow-col">
        {state && (
          <OwnerContext.Provider value={state}>
            <main>
              <Outlet />
            </main>
            {picking && <ShopSheet state={state} close={() => setPicking(false)} />}
          </OwnerContext.Provider>
        )}
        <TabBar />
      </div>
    </div>
  )
}
