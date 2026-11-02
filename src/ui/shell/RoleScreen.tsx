import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Role } from '../../domain/types'
import { t } from '../../i18n'
import { backOfficeLinks } from '../office/navItems'
import LangToggle from './LangToggle'
import Logo from './Logo'
import { useSession } from './session'
import SyncBadge from './SyncBadge'

interface NavItem {
  to: string
  label: string
}

/** The links a role sees in its header. Other roles' links are not rendered at all. */
function navFor(role: Role): NavItem[] {
  return backOfficeLinks(role).map((l) => ({ to: `/office/${l.path}`, label: l.label }))
}

/** The frame every role screen sits in: logo, who and where, links for this role, language toggle, log out, sync badge. `wide` lets a working screen (the bill) use the full width. */
export default function RoleScreen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, store, counter, logout } = useSession()
  const nav = user ? navFor(user.role) : []
  return (
    <div className="role-screen">
      <header className="shell-header">
        <Logo />
        <span className="who">
          {user?.name}
          {store && ` · ${store.name} · ${t('counter', { n: counter })}`}
        </span>
        {nav.length > 0 && (
          <nav className="shell-nav" aria-label={t('nav.menu')}>
            {nav.map((item) => (
              <Link key={item.to} to={item.to} className="nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <span className="spacer" />
        <LangToggle />
        <button type="button" className="header-button" onClick={logout}>
          {t('logout')}
        </button>
        <SyncBadge />
      </header>
      <main className={wide ? 'role-main wide' : 'role-main'}>{children}</main>
    </div>
  )
}
