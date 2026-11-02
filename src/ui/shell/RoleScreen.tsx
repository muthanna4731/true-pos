import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { backOfficeLinks } from '../office/navItems'
import LangToggle from './LangToggle'
import Logo from './Logo'
import { useSession } from './session'
import SideNav from './SideNav'
import SyncBadge from './SyncBadge'

/**
 * The frame every role screen sits in: logo, who and where, language toggle, log out, sync badge. Office and manager
 * also get the floating side menu and the compact `backoffice` sizing. `wide` lets a working screen (the bill) use the full width.
 */
export default function RoleScreen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, store, counter, logout } = useSession()
  const backOffice = user !== null && backOfficeLinks(user.role).length > 0
  return (
    <div className={backOffice ? 'role-screen backoffice' : 'role-screen'}>
      <header className="shell-header">
        <Logo />
        <span className="who">
          {user?.name}
          {store && ` · ${store.name} · ${t('counter', { n: counter })}`}
        </span>
        <span className="spacer" />
        <LangToggle />
        <button type="button" className="header-button" onClick={logout}>
          {t('logout')}
        </button>
        <SyncBadge />
      </header>
      <div className="role-body">
        {backOffice && user && <SideNav role={user.role} />}
        <main className={wide ? 'role-main wide' : 'role-main'}>{children}</main>
      </div>
    </div>
  )
}
