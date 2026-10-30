import type { Product } from '../../domain/types'
import { t } from '../../i18n'

export type ProductType = 'beer' | 'whisky' | 'rum' | 'brandy' | 'vodka' | 'gin' | 'wine' | 'other'
export type Tab = 'all' | ProductType

export const TABS: Tab[] = ['all', 'beer', 'whisky', 'rum', 'brandy', 'vodka', 'gin', 'wine', 'other']

/** Which type tab, and which tile colour, a product belongs to. Everything unlisted (liqueur, tequila, NALC) is "other". */
export function typeOf(p: Product): ProductType {
  if (p.category === 'BEER') return 'beer'
  if (p.category === 'WINE') return 'wine'
  if (p.category === 'IML') {
    switch (p.subcategory) {
      case 'WHISKY':
        return 'whisky'
      case 'RUM':
        return 'rum'
      case 'BRANDY':
        return 'brandy'
      case 'VODKA':
        return 'vodka'
      case 'GIN':
        return 'gin'
    }
  }
  return 'other'
}

interface Props {
  tab: Tab
  onChange(tab: Tab): void
}

/** All, Beer, Whisky and so on. The grid below shows only the chosen type. */
export default function TypeTabs({ tab, onChange }: Props) {
  return (
    <div className="type-tabs">
      {TABS.map((key) => (
        <button key={key} type="button" aria-pressed={tab === key} onClick={() => onChange(key)}>
          {t(`tab.${key}`)}
        </button>
      ))}
    </div>
  )
}
