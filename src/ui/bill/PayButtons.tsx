import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../../db/db'
import { DayClosedError, recordSale } from '../../db/sales'
import type { Cart, PricedCart } from '../../domain/cart'
import { formatINR } from '../../domain/money'
import { clock, istDate } from '../../domain/time'
import type { Bill, PayMode, Paise } from '../../domain/types'
import { t } from '../../i18n'
import { flushLoyaltyNow } from '../../loyalty/queue'
import { useSession } from '../shell/session'
import CashDialog from './CashDialog'
import ModeIcon from './ModeIcon'
import Receipt, { type ReceiptLine } from './Receipt'
import SplitDialog from './SplitDialog'
import UpiDialog from './UpiDialog'
import { usePractice } from './usePractice'

/** How long the receipt preview stays after a payment, unless it is tapped first. Tests shorten it. */
export const RECEIPT_TIMING = { ms: 4000 }

interface Props {
  priced: PricedCart
  cart: Cart
  onPaid(bill: Bill): void
}

type Dialog = 'cash' | 'upi' | 'split'
type Payments = { mode: PayMode; amount: Paise }[]

/** A bill with its lines and payments, as the receipt needs them. */
async function loadReceipt(number: string) {
  const [bill, lines, payments] = await Promise.all([
    db.bills.get(number),
    db.billLines.where('billNumber').equals(number).toArray(),
    db.payments.where('billNumber').equals(number).toArray(),
  ])
  if (!bill) return undefined
  const products = await db.products.bulkGet(lines.map((l) => l.productId))
  const named: ReceiptLine[] = lines.map((l, i) => ({ ...l, name: products[i]?.shortName ?? l.productId }))
  return { bill, lines: named, payments }
}

/**
 * [Cash], [UPI] and [Card] for the cart, a small [Split payment] link, [Reprint], and the receipt preview.
 * Paying records the sale at once and clears the cart for the next customer; the receipt then shows for a few seconds.
 */
export default function PayButtons({ priced, cart, onPaid }: Props) {
  const { user, store, counter, shiftId } = useSession()
  const practice = usePractice()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closedOn, setClosedOn] = useState<string | null>(null)
  const [shown, setShown] = useState<{ number: string; auto: boolean } | null>(null)
  const locked = useRef(false)

  const storeCode = store?.code
  const today = istDate(clock.now())
  const closedRow = useLiveQuery(async () => (storeCode ? (await db.dayCloses.get([storeCode, today])) !== undefined : false), [storeCode, today])
  const closed = closedRow === true || closedOn === today

  // The last bill of this shift at this counter, for [Reprint].
  const last = useLiveQuery(
    async () =>
      storeCode && shiftId
        ? db.bills
            .where('[storeCode+at]')
            .between([storeCode, Dexie.minKey], [storeCode, Dexie.maxKey])
            .reverse()
            .filter((b) => b.shiftId === shiftId && b.counter === counter)
            .first()
        : undefined,
    [storeCode, shiftId, counter],
  )

  const receipt = useLiveQuery(() => (shown ? loadReceipt(shown.number) : undefined), [shown?.number])
  const closeReceipt = useCallback(() => setShown(null), [])
  useEffect(() => {
    if (!shown?.auto) return
    const timer = setTimeout(closeReceipt, RECEIPT_TIMING.ms)
    return () => clearTimeout(timer)
  }, [shown, closeReceipt])

  const pay = async (payments: Payments): Promise<void> => {
    if (locked.current || !user || !store || !shiftId) return
    locked.current = true
    setPaying(true)
    setError(null)
    try {
      const bill = await recordSale({
        clientId: cart.clientId,
        storeCode: store.code,
        counter,
        cashierId: user.id,
        shiftId,
        lines: priced.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          mrp: l.mrp,
          ...(l.offerCode ? { offerCode: l.offerCode } : {}),
          discount: l.discount,
          tax: l.tax,
        })),
        payments,
        ...(cart.memberCode ? { memberCode: cart.memberCode } : {}),
        practice: practice === true,
      })
      setDialog(null)
      setShown({ number: bill.number, auto: true })
      onPaid(bill)
      // The earn was queued with the sale; send it now (offline, it stays queued).
      if (bill.memberCode && bill.status === 'paid') flushLoyaltyNow()
    } catch (e) {
      setDialog(null)
      if (e instanceof DayClosedError) setClosedOn(today)
      else setError(t('pay.failed'))
    } finally {
      locked.current = false
      setPaying(false)
    }
  }
  const payAll = (mode: PayMode) => () => void pay([{ mode, amount: priced.net }])

  const ready = Boolean(user && store && shiftId) && practice !== undefined && closedRow !== undefined
  const canPay = ready && !closed && priced.lines.length > 0

  return (
    <div className="pay-buttons" data-slot="pay">
      {closed && <p className="day-closed">{t('pay.dayClosed')}</p>}
      {error !== null && (
        <p className="pay-error" role="alert">
          {error}
        </p>
      )}
      {canPay && (
        <>
          <div className="pay-row">
            <button type="button" className="pay-big" disabled={paying} onClick={() => setDialog('cash')}>
              <ModeIcon mode="cash" />
              {t('pay.cash', { amount: formatINR(priced.net) })}
            </button>
            <button type="button" className="pay-big" disabled={paying} onClick={() => setDialog('upi')}>
              <ModeIcon mode="upi" />
              {t('pay.upi', { amount: formatINR(priced.net) })}
            </button>
            <button type="button" className="pay-big" disabled={paying} onClick={payAll('card')}>
              <ModeIcon mode="card" />
              {t('pay.card', { amount: formatINR(priced.net) })}
            </button>
          </div>
          <button type="button" className="link-button" disabled={paying} onClick={() => setDialog('split')}>
            {t('pay.split')}
          </button>
        </>
      )}
      {ready && last && (
        <button type="button" className="link-button" onClick={() => setShown({ number: last.number, auto: false })}>
          {t('pay.reprint')}
        </button>
      )}

      {canPay && dialog === 'cash' && <CashDialog total={priced.net} busy={paying} onPay={payAll('cash')} onCancel={() => setDialog(null)} />}
      {canPay && dialog === 'upi' && store && <UpiDialog store={store} total={priced.net} busy={paying} onPaid={payAll('upi')} onCancel={() => setDialog(null)} />}
      {canPay && dialog === 'split' && <SplitDialog total={priced.net} busy={paying} onPay={(parts) => void pay(parts)} onCancel={() => setDialog(null)} />}

      {shown && receipt && store && receipt.bill.number === shown.number && (
        <div className="modal-overlay" role="dialog" aria-label={t('receipt.title')} onClick={closeReceipt}>
          <div className="receipt-sheet">
            <div className="receipt-print">
              <Receipt bill={receipt.bill} lines={receipt.lines} payments={receipt.payments} store={store} practice={receipt.bill.status === 'practice'} />
            </div>
            <div className="receipt-actions">
              <p>{t('pay.tapClose')}</p>
              {!shown.auto && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.print()
                  }}
                >
                  {t('pay.print')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
