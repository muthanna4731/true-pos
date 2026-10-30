import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { istDayRange } from '../../db/dayData'
import { db } from '../../db/db'
import { formatINR } from '../../domain/money'
import { clock, formatTime, istDate } from '../../domain/time'
import type { Bill, PayMode } from '../../domain/types'
import { t } from '../../i18n'
import { useLoyaltyFlag } from '../../loyalty/flags'
import { useSession } from '../shell/session'
import BillDialog from './BillDialog'
import PageHeader from './PageHeader'

/** Today's bills at this shop, newest first. Tap one to see it, reprint it or void it. */
export default function BillsList() {
  const { store } = useSession()
  const code = store?.code
  const loyalty = useLoyaltyFlag()
  const [open, setOpen] = useState<string | null>(null)
  const today = istDate(clock.now())

  const data = useLiveQuery(async () => {
    if (!code) return undefined
    const [from, to] = istDayRange(today)
    const bills = (await db.bills.where('[storeCode+at]').between([code, from], [code, to], true, false).toArray()).reverse()
    const payments = await db.payments.where('billNumber').anyOf(bills.map((b) => b.number)).toArray()
    const modes = new Map<string, PayMode[]>()
    for (const p of payments) modes.set(p.billNumber, [...(modes.get(p.billNumber) ?? []), p.mode])
    const ids = [...new Set(bills.map((b) => b.cashierId))]
    const users = await db.users.bulkGet(ids)
    const names = new Map(ids.map((id, i) => [id, users[i]?.name ?? id]))
    const locked = (await db.dayCloses.get([code, today])) !== undefined
    return { bills, modes, names, locked }
  }, [code, today])

  const canVoid = (b: Bill): boolean => b.status === 'paid' && b.storeCode === code && istDate(b.at) === today && data?.locked === false

  return (
    <>
      <PageHeader title={t('mgr.bills')} />
      {data && data.bills.length === 0 && <p className="empty">{t('bills.empty')}</p>}
      <ul className="bills-list" aria-label={t('mgr.bills')}>
        {data?.bills.map((b) => (
          <li key={b.number}>
            <button type="button" className={`bill-row status-${b.status}`} onClick={() => setOpen(b.number)}>
              <span className="bill-number">{b.number}</span>
              <span>{formatTime(b.at)}</span>
              <span>{data.names.get(b.cashierId)}</span>
              {loyalty && <span>{b.customerName ?? b.memberCode ?? ''}</span>}
              <span className="bill-amount">{formatINR(b.net)}</span>
              <span>{(data.modes.get(b.number) ?? []).map((m) => t(m)).join(' + ')}</span>
              {b.status === 'practice' && <span className="tag tag-practice">{t('bills.tagPractice')}</span>}
              {b.status === 'void' && <span className="tag tag-void">{t('bills.tagVoid')}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && store && (
        <BillDialog
          number={open}
          store={store}
          canVoid={data?.bills.some((b) => b.number === open && canVoid(b)) === true}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
