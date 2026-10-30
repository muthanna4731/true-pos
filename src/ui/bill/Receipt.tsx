import { formatINR } from '../../domain/money'
import { formatDate, formatTime } from '../../domain/time'
import type { Bill, BillLine, Payment, Store } from '../../domain/types'
import { t } from '../../i18n'

export type ReceiptLine = BillLine & { name: string }

interface Props {
  bill: Bill
  lines: ReceiptLine[]
  payments: Payment[]
  store: Store
  practice: boolean
}

const MODE_LABEL = { cash: 'cash', upi: 'upi', card: 'card' } as const

/** The bill as an 80 mm till slip. Used for the on-screen preview and, through print.css, for printing. */
export default function Receipt({ bill, lines, payments, store, practice }: Props) {
  return (
    <article className="receipt" style={{ width: '80mm' }}>
      {practice && <p className="receipt-practice">{t('receipt.practice')}</p>}
      <h2 className="receipt-store">{store.name}</h2>
      <p>{t('receipt.licence', { no: store.licenceNo })}</p>
      <p className="receipt-number">{bill.number}</p>
      <p>
        {formatDate(bill.at)} · {formatTime(bill.at)}
      </p>
      <ul className="receipt-lines">
        {lines.map((l) => (
          <li key={l.id ?? l.productId}>
            <span className="receipt-name">{l.name}</span>
            <span>×{l.qty}</span>
            <span>{formatINR(l.mrp)}</span>
            <span>{formatINR(l.amount)}</span>
          </li>
        ))}
      </ul>
      {bill.discount > 0 && (
        <p className="receipt-row">
          <span>{t('receipt.discount')}</span>
          <span>−{formatINR(bill.discount)}</span>
        </p>
      )}
      {bill.tax > 0 && (
        <p className="receipt-row">
          <span>{t('receipt.tax')}</span>
          <span>{formatINR(bill.tax)}</span>
        </p>
      )}
      <p className="receipt-row receipt-total">
        <span>{t('receipt.total')}</span>
        <span>{formatINR(bill.net)}</span>
      </p>
      {payments.map((p) => (
        <p key={p.id ?? p.mode} className="receipt-row">
          <span>{t(MODE_LABEL[p.mode])}</span>
          <span>{formatINR(p.amount)}</span>
        </p>
      ))}
    </article>
  )
}
