import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db/db'
import { voidBill } from '../../db/sales'
import { sha256Hex } from '../../domain/hash'
import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import { loadReceipt } from '../bill/loadReceipt'
import Receipt from '../bill/Receipt'
import PinPad from '../shell/PinPad'
import { useSession } from '../shell/session'

interface Props {
  number: string
  store: Store
  /** Voiding is allowed: a paid bill of today at this shop, on a day that is not locked. */
  canVoid: boolean
  onClose(): void
}

/** One bill: its lines, [Reprint], and [Void], which asks for the manager's PIN again. */
export default function BillDialog({ number, store, canVoid, onClose }: Props) {
  const { user } = useSession()
  const [asking, setAsking] = useState(false)
  const receipt = useLiveQuery(() => loadReceipt(number), [number])

  /** The same check as login, against the manager who is signed in. */
  const confirm = async (pin: string): Promise<boolean> => {
    const manager = user ? await db.users.get(user.id) : undefined
    if (!manager || manager.role !== 'manager' || manager.pinHash !== sha256Hex(`${manager.id}:${pin}`)) return false
    await voidBill(number, manager.id)
    onClose()
    return true
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bill-dialog" role="dialog" aria-label={t('bills.title', { number })} onClick={(e) => e.stopPropagation()}>
        {receipt && (
          <div className="receipt-print">
            <Receipt bill={receipt.bill} lines={receipt.lines} payments={receipt.payments} store={store} practice={receipt.bill.status === 'practice'} />
          </div>
        )}
        {receipt?.bill.status === 'void' && <p className="tag tag-void">{t('bills.tagVoid')}</p>}
        {asking ? (
          <div className="void-pin">
            <p>{t('bills.pinFor', { number })}</p>
            <PinPad onSubmit={confirm} />
            <button type="button" onClick={() => setAsking(false)}>
              {t('pay.cancel')}
            </button>
          </div>
        ) : (
          <div className="bill-actions">
            <button type="button" onClick={() => window.print()}>
              {t('pay.reprint')}
            </button>
            {canVoid && receipt?.bill.status === 'paid' && (
              <button type="button" className="danger" onClick={() => setAsking(true)}>
                {t('bills.void')}
              </button>
            )}
            <button type="button" onClick={onClose}>
              {t('close.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
