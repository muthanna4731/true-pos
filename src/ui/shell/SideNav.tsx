import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { Role } from '../../domain/types'
import { t } from '../../i18n'
import { backOfficeLinks } from '../office/navItems'

/** Stroke icons, 24 x 24, drawn in the current text colour. Keyed by the route below /office ('' is the home). */
const ICONS: Record<string, ReactNode> = {
  '': <path d="M4 11l8-7 8 7M6 10v10h12V10M10 20v-6h4v6" />,
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  deliveries: (
    <>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  arrived: (
    <>
      <path d="M4 8l8-4 8 4v9l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v9" />
    </>
  ),
  count: (
    <>
      <path d="M9 4h6l1 2h3v15H5V6h3z" />
      <path d="M9 13l2 2 4-4" />
    </>
  ),
  transfers: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  stock: <path d="M4 20V8h4v12M10 20V4h4v16M16 20v-9h4v9" />,
  losses: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  suppliers: (
    <>
      <path d="M4 10l1-5h14l1 5M4 10v10h16V10M4 10h16" />
      <path d="M9 20v-5h6v5" />
    </>
  ),
  products: (
    <>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.3" />
    </>
  ),
  reports: <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />,
  bills: (
    <>
      <path d="M5 3h14v18H5z" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </>
  ),
  close: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  offers: (
    <>
      <path d="M4 12V4h8l8 8-8 8z" />
      <path d="M9 9l5 5M9.5 14.5h.01M14 9.5h.01" />
    </>
  ),
  shops: <path d="M3 9l2-5h14l2 5M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M5 12v8h14v-8" />,
}

function Icon({ name }: { name: string }) {
  return (
    <svg className="side-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}

/**
 * The back office's floating pill menu (office and manager). Each item is a NavLink, so the active one follows the route,
 * nested pages included. Narrow screens show icons only (labels stay as the accessible name), phones get it at the bottom.
 * A role with no back-office links gets no menu at all.
 */
export default function SideNav({ role }: { role: Role }) {
  const links = backOfficeLinks(role)
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  // On a phone the capsule scrolls sideways; keep the current page in view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [pathname])
  if (links.length === 0) return null
  const items = [{ path: '', label: t('nav.home') }, ...links]
  return (
    <nav className="side-nav" aria-label={t('nav.menu')} ref={nav}>
      {items.map((item) => (
        <NavLink key={item.path} to={item.path ? `/office/${item.path}` : '/office'} end={item.path === ''} className="side-link" aria-label={item.label} title={item.label}>
          <Icon name={item.path} />
          <span className="side-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
