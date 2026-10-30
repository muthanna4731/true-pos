import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Role } from '../../domain/types'
import { t } from '../../i18n'
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
  switch (role) {
    case 'manager':
      return [
        { to: '/manager', label: t('role.manager') },
        { to: '/bill', label: t('nav.bill') },
      ]
    case 'office':
      return [
        { to: '/office/orders', label: t('nav.orders') },
        { to: '/office/deliveries', label: t('nav.deliveries') },
        { to: '/office/transfers', label: t('nav.transfers') },
        { to: '/office/stock', label: t('nav.stock') },
        { to: '/office/losses', label: t('nav.losses') },
        { to: '/office/suppliers', label: t('nav.suppliers') },
        { to: '/office/products', label: t('nav.products') },
        { to: '/office/reports', label: t('nav.reports') },
        { to: '/office/shops', label: t('nav.shops') },
      ]
    default:
      return []
  }
}

/** The frame every role screen sits in: logo, who and where, links for this role, language toggle, log out, sync badge. */
export default function RoleScreen({ children }: { children: ReactNode }) {
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
          <nav className="shell-nav">
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
      <main className="role-main">{children}</main>
    </div>
  )
}
