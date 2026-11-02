import type { Role } from '../../domain/types'
import { t } from '../../i18n'

export interface BackOfficeLink {
  /** Route below /office. */
  path: string
  label: string
  /** Shown as a tab on the office home; the rest sit under [More]. */
  primary: boolean
  /** Has its own button in the manager's quick row, so [More] leaves it out. */
  quick: boolean
}

interface LinkDef {
  path: string
  label: string
  primary?: boolean
  quick?: boolean
  managerOnly?: boolean
}

/** In the order the side nav shows them: the shared pages first, then the manager's own. */
const LINKS: LinkDef[] = [
  { path: 'orders', label: 'nav.orders', primary: true },
  { path: 'deliveries', label: 'nav.deliveries', primary: true },
  { path: 'arrived', label: 'mgr.stockArrived', primary: true },
  { path: 'count', label: 'mgr.countShelf', primary: true },
  { path: 'transfers', label: 'nav.transfers', primary: true },
  { path: 'stock', label: 'nav.stock', primary: true },
  { path: 'losses', label: 'nav.losses' },
  { path: 'suppliers', label: 'nav.suppliers' },
  { path: 'products', label: 'nav.products' },
  { path: 'reports', label: 'nav.reports' },
  { path: 'bills', label: 'mgr.bills', quick: true, managerOnly: true },
  { path: 'close', label: 'mgr.closeShift', quick: true, managerOnly: true },
  { path: 'offers', label: 'nav.offers', managerOnly: true },
  { path: 'shops', label: 'nav.shops', quick: true, managerOnly: true },
]

/** The back-office links a role gets: office the shared ones, manager those and its own. Other roles get none. Labels follow the language. */
export function backOfficeLinks(role: Role): BackOfficeLink[] {
  if (role !== 'office' && role !== 'manager') return []
  return LINKS.filter((l) => !l.managerOnly || role === 'manager').map((l) => ({
    path: l.path,
    label: t(l.label),
    primary: l.primary === true,
    quick: l.quick === true,
  }))
}
