import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getLang, setLang, t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { useSession } from '../shell/session'
import { useOwner } from './ownerContext'
import { Chevron, OwnerHeader, Section } from './parts'

const ICON = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const LINKS: { to: string; name: string; sub: string; icon: ReactNode }[] = [
  { to: '/owner/more/purchases', name: 'ow.purchases', sub: 'ow.purchasesSub', icon: <path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" /> },
  { to: '/owner/more/reports', name: 'ow.reports', sub: 'ow.reportsSub', icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  { to: '/owner/more/offers', name: 'owner.offers', sub: 'ow.offersSub', icon: <><path d="M18 5L6 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></> },
  { to: '/owner/prices', name: 'owner.pushPrices', sub: 'ow.pricesSub', icon: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></> },
  { to: '/owner/more/downloads', name: 'owner.downloads', sub: 'ow.downloadsSub', icon: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" /> },
  { to: '/owner/more/summary', name: 'ow.nightly', sub: 'ow.nightlySub', icon: <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" /> },
  { to: '/owner/more/shops', name: 'ow.shops', sub: 'ow.shopsSub', icon: <path d="M3 9l2-5h14l2 5M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M5 12v8h14v-8" /> },
]

/** More: the owner's reports and tools, then day or night, the language and log out. */
export default function MoreTab() {
  useLang()
  const { theme, pickTheme, scopeName } = useOwner()
  const { logout } = useSession()
  return (
    <div className="ow-app">
      <OwnerHeader title={t('ow.more')} sub={`${scopeName} · ${t('ow.moreTools')}`} />

      <div className="ow-list">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="ow-rlink">
            <span className="ow-rico">
              <svg {...ICON} aria-hidden="true">
                {l.icon}
              </svg>
            </span>
            <span className="ow-nm">
              <b>{t(l.name)}</b>
              <span>{t(l.sub)}</span>
            </span>
            <Chevron />
          </Link>
        ))}
      </div>

      <Section title={t('ow.appearance')} />
      <div className="ow-themebar">
        <div className="ow-toggle" role="group" aria-label={t('ow.themeLabel')}>
          <button type="button" aria-pressed={theme === 'light'} onClick={() => pickTheme('light')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            {t('ow.themeDay')}
          </button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => pickTheme('dark')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
            </svg>
            {t('ow.themeNight')}
          </button>
        </div>
      </div>

      <div className="ow-list" style={{ marginTop: 14 }}>
        <button type="button" className="ow-rlink" onClick={() => setLang(getLang() === 'en' ? 'kn' : 'en')}>
          <span className="ow-nm">
            <b>ಕನ್ನಡ / EN</b>
          </span>
          <Chevron />
        </button>
        <button type="button" className="ow-rlink" onClick={logout}>
          <span className="ow-nm">
            <b style={{ color: 'var(--oxblood)' }}>{t('logout')}</b>
          </span>
        </button>
      </div>
    </div>
  )
}
