import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
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
      <path d="M18 5L6 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
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

const COLLAPSED_KEY = 'navCollapsed'

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

interface Tip {
  label: string
  top: number
  left: number
}

/**
 * The back office's floating menu (office and manager). Each item is a NavLink, so the active one follows the route,
 * nested pages included. On a laptop it can be collapsed to icons (remembered); tablets always show icons, and an icon
 * shows its name to its right on hover or focus. Phones get the menu along the bottom. A role with no back-office links
 * gets no menu at all.
 */
export default function SideNav({ role }: { role: Role }) {
  const links = backOfficeLinks(role)
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(storedCollapsed)
  const [tip, setTip] = useState<Tip | null>(null)
  // On a phone the capsule scrolls sideways; centre the current page in it. Setting scrollLeft moves only the capsule
  // (scrollIntoView would also nudge the window), and it does nothing where the capsule is a column.
  useEffect(() => {
    const box = nav.current
    const current = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (box && current) box.scrollLeft = current.offsetLeft - (box.clientWidth - current.offsetWidth) / 2
    setTip(null)
  }, [pathname])
  if (links.length === 0) return null
  const items = [{ path: '', label: t('nav.home') }, ...links]

  const toggle = (): void => {
    setCollapsed(!collapsed)
    setTip(null)
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {
      // The choice just won't be remembered.
    }
  }

  // The name pops out only where the labels are hidden, and not on the phone bar along the bottom.
  const showTip = (e: SyntheticEvent<HTMLElement>, label: string): void => {
    const link = e.currentTarget
    const text = link.querySelector('.side-label')
    if (!text || getComputedStyle(text).display !== 'none') return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 599px)').matches) return
    const box = link.getBoundingClientRect()
    setTip({ label, top: box.top + box.height / 2, left: box.right + 12 })
  }
  const hideTip = (): void => setTip(null)

  return (
    <>
      <nav className={collapsed ? 'side-nav collapsed' : 'side-nav'} aria-label={t('nav.menu')} ref={nav} onScroll={hideTip}>
        <button type="button" className="side-toggle" aria-expanded={!collapsed} aria-label={collapsed ? t('nav.expand') : t('nav.collapse')} title={collapsed ? t('nav.expand') : t('nav.collapse')} onClick={toggle}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
            <path d="M9.5 4.5v15" />
            <path d={collapsed ? 'M13.5 10l2 2-2 2' : 'M16 10l-2 2 2 2'} />
          </svg>
        </button>
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path ? `/office/${item.path}` : '/office'}
            end={item.path === ''}
            className="side-link"
            aria-label={item.label}
            onMouseEnter={(e) => showTip(e, item.label)}
            onMouseLeave={hideTip}
            onFocus={(e) => showTip(e, item.label)}
            onBlur={hideTip}
          >
            <Icon name={item.path} />
            <span className="side-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      {tip && (
        <span className="side-tip" style={{ top: tip.top, left: tip.left }} aria-hidden="true">
          {tip.label}
        </span>
      )}
    </>
  )
}
