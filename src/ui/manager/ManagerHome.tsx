import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { loadDayTotals } from '../../db/dayData'
import { db } from '../../db/db'
import { formatINR } from '../../domain/money'
import { isDayTotals } from '../../domain/reports'
import { clock, istDate } from '../../domain/time'
import { t } from '../../i18n'
import { usePractice } from '../bill/usePractice'
import AsOf from '../common/AsOf'
import BigButton from '../common/BigButton'
import { useSession } from '../shell/session'

const billsText = (n: number): string => (n === 1 ? t('glance.billOne') : t('glance.billMany', { n }))

/** Three big buttons, today's figures stamped with their time, then [Bills] and [Practice mode]. */
export default function ManagerHome() {
  const { store } = useSession()
  const navigate = useNavigate()
  const practice = usePractice()
  const code = store?.code
  const today = istDate(clock.now())

  const live = useLiveQuery(() => (code ? loadDayTotals(code, today) : undefined), [code, today])
  const dayClose = useLiveQuery(async () => (code ? ((await db.dayCloses.get([code, today])) ?? null) : undefined), [code, today])
  // A closed day shows the numbers that were locked, not a fresh sum.
  const totals = dayClose && isDayTotals(dayClose.totals) ? dayClose.totals : live

  return (
    <div className="manager-home">
      <h1>{t('home.manager')}</h1>
      <div className="big-buttons">
        <BigButton onClick={() => navigate('stock')}>{t('mgr.stockArrived')}</BigButton>
        <BigButton onClick={() => navigate('count')}>{t('mgr.countShelf')}</BigButton>
        <BigButton onClick={() => navigate('close')}>{t('mgr.closeShift')}</BigButton>
      </div>

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
        <button type="button" onClick={() => navigate('bills')}>
          {t('mgr.bills')}
        </button>
        {practice !== undefined && (
          <>
            <button
              type="button"
              aria-pressed={practice}
              onClick={() => void db.kv.put({ key: 'practice', value: !practice })}
            >
              {t('mgr.practice')}
            </button>
            <span className="practice-state">{practice ? t('demo.on') : t('demo.off')}</span>
          </>
        )}
      </div>
    </div>
  )
}
