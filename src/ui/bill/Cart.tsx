import { useState, type Dispatch } from 'react'
import type { CartAction, PricedCart } from '../../domain/cart'
import { formatINR } from '../../domain/money'
import { t } from '../../i18n'
import QtyKeypad from './QtyKeypad'

interface Props {
  priced: PricedCart
  /** Stock on hand per product in the cart. A product not in the map has not been looked up yet. */
  stock: Map<string, number> | undefined
  dispatch: Dispatch<CartAction>
}

/** The bill so far. Tap a line for its ✕, tap the quantity for the keypad. Nothing here asks "are you sure?". */
export default function Cart({ priced, stock, dispatch }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [keypadFor, setKeypadFor] = useState<string | null>(null)
  const keypadLine = priced.lines.find((l) => l.productId === keypadFor)

  return (
    <section className="cart" aria-label={t('bill.cart')}>
      {priced.lines.length === 0 ? (
        <p className="cart-empty">{t('bill.empty')}</p>
      ) : (
        <ul className="cart-lines">
          {priced.lines.map((line) => {
            const id = line.productId
            const open = selected === id
            const left = stock?.get(id)
            const outOfStock = left !== undefined && left <= 0
            return (
              <li key={id} className="cart-line">
                <div className="line-top">
                  <button type="button" className="line-name" aria-expanded={open} onClick={() => setSelected(open ? null : id)}>
                    {line.shortName}
                  </button>
                  <span className="line-amount">{formatINR(line.amount)}</span>
                </div>
                <div className="line-controls">
                  <button type="button" aria-label={t('bill.less', { name: line.shortName })} onClick={() => dispatch({ type: 'setQty', productId: id, qty: line.qty - 1 })}>
                    −
                  </button>
                  <button type="button" className="line-qty" aria-label={t('bill.changeQty', { name: line.shortName })} onClick={() => setKeypadFor(id)}>
                    ×{line.qty}
                  </button>
                  <button type="button" aria-label={t('bill.more', { name: line.shortName })} onClick={() => dispatch({ type: 'setQty', productId: id, qty: line.qty + 1 })}>
                    +
                  </button>
                  <span className="line-each">{t('bill.each', { price: formatINR(line.mrp) })}</span>
                  {open && (
                    <button
                      type="button"
                      className="line-remove danger"
                      aria-label={t('bill.remove')}
                      onClick={() => {
                        dispatch({ type: 'remove', productId: id })
                        setSelected(null)
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {line.discount > 0 && <p className="line-offer">{t('bill.offer', { amount: formatINR(line.discount) })}</p>}
                {outOfStock && <p className="stock-note">{t('bill.stockZero')}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {keypadLine && (
        <QtyKeypad
          name={keypadLine.shortName}
          current={keypadLine.qty}
          onSet={(qty) => dispatch({ type: 'setQty', productId: keypadLine.productId, qty })}
          onClose={() => setKeypadFor(null)}
        />
      )}
    </section>
  )
}
