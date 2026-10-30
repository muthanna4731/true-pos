import { formatINR } from '../../domain/money'
import type { Paise, Product } from '../../domain/types'
import { t } from '../../i18n'
import Tile from '../common/Tile'
import { typeOf } from './TypeTabs'

interface Props {
  products: Product[]
  mrpOf(id: string): Paise
  onAdd(productId: string): void
}

/** The shop's best sellers of the last 14 days, one tile per exact product. One tap adds one bottle. */
export default function TopTiles({ products, mrpOf, onAdd }: Props) {
  return (
    <section className="top-tiles" aria-label={t('bill.top12')}>
      <h2>{t('bill.top12')}</h2>
      <div className="top-grid">
        {products.map((p) => (
          <Tile key={p.id} type={typeOf(p)} image={p.image} label={p.shortName} onClick={() => onAdd(p.id)}>
            <span className="tile-name">{p.shortName}</span>
            <span className="tile-price">{formatINR(mrpOf(p.id))}</span>
          </Tile>
        ))}
      </div>
    </section>
  )
}
