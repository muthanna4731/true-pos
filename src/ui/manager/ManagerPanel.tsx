import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { loadDayTotals } from '../../db/dayData'
import { db } from '../../db/db'
import { setPractice } from '../../db/settings'
import { formatINR } from '../../domain/money'
import { isDayTotals } from '../../domain/reports'
import { clock, istDate } from '../../domain/time'
import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import { usePractice } from '../bill/usePractice'
import AsOf from '../common/AsOf'
import ShopScope, { ShopPicker } from '../office/ShopScope'

const billsText = (n: number): string => (n === 1 ? t('glance.billOne') : t('glance.billMany', { n }))

/** The manager's row on the office home: quick actions, then one shop's day at a glance and its practice switch. */
export default function ManagerPanel() {
  const navigate = useNavigate()
  return (
    <section className="manager-panel" aria-label={t('mgr.row')}>
      <h2>{t('mgr.row')}</h2>
      <div className="manager-actions">
        <button type="button" onClick={() => navigate('/office/close')}>
          {t('mgr.closeShift')}
        </button>
        <button type="button" onClick={() => navigate('/office/bills')}>
          {t('mgr.bills')}
        </button>
        <button type="button" onClick={() => navigate('/office/products')}>
          {t('mgr.prices')}
        </button>
        <button type="button" onClick={() => navigate('/office/shops')}>
          {t('nav.shops')}
        </button>
        <ShopPicker className="shop-pick inline-pick" />
      </div>
      <ShopScope picker={false}>{(store) => <ShopToday store={store} />}</ShopScope>
    </section>
  )
}

/** Today's figures for one shop, stamped with their time, and its [Practice mode] switch. */
function ShopToday({ store }: { store: Store }) {
  const practice = usePractice(store.code)
  const code = store.code
  const today = istDate(clock.now())

  const live = useLiveQuery(() => loadDayTotals(code, today), [code, today])
  const dayClose = useLiveQuery(async () => (await db.dayCloses.get([code, today])) ?? null, [code, today])
  // A closed day shows the numbers that were locked, not a fresh sum.
  const totals = dayClose && isDayTotals(dayClose.totals) ? dayClose.totals : live

  return (
    <>
      <section className="glance" aria-label={t('mgr.glance')}>
        <h2>{t('mgr.glance')}</h2>
        {totals && dayClose !== undefined && (
          <>
            <p className="glance-line">
              <strong>{t('glance.line', { net: formatINR(totals.net), bills: billsText(totals.bills), avg: formatINR(totals.avgBill) })}</strong>{' '}
              <AsOf dayClose={dayClose ?? undefined} now={clock.now()} />
            </p>
            <div className="glance-grid">
              <dl>
                <div>
                  <dt>{t('cash')}</dt>
                  <dd>{formatINR(totals.byMode.cash)}</dd>
                </div>
                <div>
                  <dt>{t('upi')}</dt>
                  <dd>{formatINR(totals.byMode.upi)}</dd>
                </div>
                <div>
                  <dt>{t('card')}</dt>
                  <dd>{formatINR(totals.byMode.card)}</dd>
                </div>
              </dl>
              <dl>
                <div>
                  <dt>{t('glance.alc')}</dt>
                  <dd>{formatINR(totals.alc)}</dd>
                </div>
                <div>
                  <dt>{t('glance.nalc')}</dt>
                  <dd>{formatINR(totals.nalc)}</dd>
                </div>
                <div>
                  <dt>{t('glance.discount')}</dt>
                  <dd>{formatINR(totals.discount)}</dd>
                </div>
                <div>
                  <dt>{t('glance.mtd')}</dt>
                  <dd>{formatINR(totals.monthToDate)}</dd>
                </div>
              </dl>
              <dl>
                {Object.entries(totals.byType).map(([type, row]) => (
                  <div key={type}>
                    <dt>{t(`tab.${type}`)}</dt>
                    <dd>
                      {row.qty === 1 ? t('glance.bottleOne', { amount: formatINR(row.amount) }) : t('glance.bottleMany', { n: row.qty, amount: formatINR(row.amount) })}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}
      </section>

      <div className="home-links">
        {practice !== undefined && (
          <>
            <button type="button" aria-pressed={practice} onClick={() => void setPractice(code, !practice)}>
              {t('mgr.practice')}
            </button>
            <span className="practice-state">{practice ? t('demo.on') : t('demo.off')}</span>
          </>
        )}
      </div>
    </>
  )
}
