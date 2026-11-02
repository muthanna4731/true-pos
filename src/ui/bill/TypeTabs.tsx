import { typeOf, type ProductType } from '../../domain/productType'
import { t } from '../../i18n'

export type { ProductType }
export { typeOf }
export type Tab = 'all' | ProductType

export const TABS: Tab[] = ['all', 'beer', 'whisky', 'rum', 'brandy', 'vodka', 'gin', 'wine', 'other']

interface Props {
  tab: Tab
  onChange(tab: Tab): void
}

/** All, Beer, Whisky and so on. The grid below shows only the chosen type. The dots are the legend for the tile dots. */
export default function TypeTabs({ tab, onChange }: Props) {
  return (
    <div className="type-tabs">
      {TABS.map((key) => (
        <button key={key} type="button" className={key === 'all' ? undefined : `type-${key}`} aria-pressed={tab === key} onClick={() => onChange(key)}>
          {key !== 'all' && <span className="type-dot" aria-hidden="true" />}
          {t(`tab.${key}`)}
        </button>
      ))}
    </div>
  )
}
