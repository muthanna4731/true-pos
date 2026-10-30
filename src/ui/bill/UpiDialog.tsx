import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { formatINR } from '../../domain/money'
import type { Paise, Store } from '../../domain/types'
import { upiUri } from '../../domain/upi'
import { t } from '../../i18n'

interface Props {
  store: Store
  total: Paise
  busy: boolean
  onPaid(): void
  onCancel(): void
}

/** The shop's UPI QR with the amount filled in. The demo does not check that the money arrived: [Paid] is the cashier's word. */
export default function UpiDialog({ store, total, busy, onPaid, onCancel }: Props) {
  const [svg, setSvg] = useState('')

  // The bill has no number yet, so the store code stands in as the note on the payment.
  useEffect(() => {
    let live = true
    QRCode.toString(upiUri(store.upiVpa, store.name, total, store.code), { type: 'svg', margin: 1 })
      .then((markup) => {
        if (live) setSvg(markup)
      })
      .catch(() => {
        if (live) setSvg('')
      })
    return () => {
      live = false
    }
  }, [store.upiVpa, store.name, store.code, total])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="pay-dialog" role="dialog" aria-label={t('upi')} onClick={(e) => e.stopPropagation()}>
        <p className="pay-amount">{formatINR(total)}</p>
        <p className="upi-hint">{t('pay.scan', { name: store.name })}</p>
        <div className="upi-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="pay-actions">
          <button type="button" onClick={onCancel}>
            {t('pay.cancel')}
          </button>
          <button type="button" className="pay-primary" disabled={busy} onClick={onPaid}>
            {t('pay.paid')}
          </button>
        </div>
      </div>
    </div>
  )
}
