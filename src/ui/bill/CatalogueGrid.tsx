import type { Product } from '../../domain/types'
import type { BrandTile } from '../../domain/sellers'
import { t } from '../../i18n'
import Tile from '../common/Tile'
import { typeOf } from './TypeTabs'

interface Props {
  tiles: BrandTile[]
  onAdd(productId: string): void
  /** Shown beside "No match" to put search and tab back to everything. */
  onClear(): void
}

/** The name without its size: "KF Strong 650" becomes "KF Strong". */
const nameOf = (p: Product): string => p.shortName.replace(/ \d+$/, '')

/** Text of a size button: 180, 1L. A size sold in two packs also names the pack. */
function sizeLabel(p: Product, sizes: Product[]): string {
  if (p.sizeMl === null) return p.shortName
  const base = p.sizeMl >= 1000 && p.sizeMl % 1000 === 0 ? `${p.sizeMl / 1000}L` : String(p.sizeMl)
  const twin = sizes.some((o) => o !== p && o.sizeMl === p.sizeMl)
  return twin && p.pack ? `${base} ${p.pack.toLowerCase()}` : base
}

/** One tile per brand. Its sizes are buttons, and one tap on a size adds that bottle. */
export default function CatalogueGrid({ tiles, onAdd, onClear }: Props) {
  return (
    <section className="catalogue" aria-label={t('bill.allBottles')}>
      <h2>{t('bill.allBottles')}</h2>
      {tiles.length === 0 ? (
        <div className="no-match">
          <p>{t('noMatch')}</p>
          <button type="button" onClick={onClear}>
            {t('bill.clear')}
          </button>
        </div>
      ) : (
        <div className="brand-grid">
          {tiles.map((tile) => {
            const first = tile.sizes[0]
            return (
              <Tile key={`${tile.subcategory}/${tile.brand}`} type={typeOf(first)} image={first.image}>
                <span className="tile-name">{nameOf(first)}</span>
                <span className="tile-brand">{tile.brand.toLowerCase()}</span>
                <span className="size-buttons">
                  {tile.sizes.map((p) => (
                    <button key={p.id} type="button" aria-label={p.shortName} onClick={() => onAdd(p.id)}>
                      {sizeLabel(p, tile.sizes)}
                    </button>
                  ))}
                </span>
              </Tile>
            )
          })}
        </div>
      )}
    </section>
  )
}
