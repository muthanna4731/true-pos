import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../db/db'
import { topSellers } from '../../domain/sellers'
import { clock, formatDate } from '../../domain/time'
import { t } from '../../i18n'
import { setLoyaltyEnabled } from '../../loyalty/demoClient'
import { requestLoyaltyRefresh } from '../../loyalty/flags'
import { advanceClock, resetDemo } from '../../seed/load'
import { closeDemoPanel, openDemoPanel, useDemoPanelOpen, useSeedOptions } from './demoPanelState'
import { useSession } from './session'

const DAY_MS = 86400000

/** The demo members from the seed, as the customer app's QR would show them. */
const MEMBERS = [
  { code: '7K3M9QX2RA', name: 'Ravi' },
  { code: 'B4N8TC5WZ6', name: 'Meena' },
  { code: 'H2D9F7GKP3', name: 'Kiran' },
]

/** Type a code the way a scanner does: every key in the same instant, then Enter. */
function simulateScan(code: string): void {
  for (const key of code) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

/** Hidden demo controls. Opens with Ctrl+Shift+D, or three taps on the logo. */
export default function DemoPanel() {
  const open = useDemoPanelOpen()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        openDemoPanel()
      } else if (e.key === 'Escape') {
        closeDemoPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return open ? <PanelBody /> : null
}

function PanelBody() {
  const navigate = useNavigate()
  const { store, logout } = useSession()
  const seedOptions = useSeedOptions()
  const [today, setToday] = useState(() => formatDate(clock.now()))
  const [resetting, setResetting] = useState(false)

  const loyaltyRow = useLiveQuery(() => db.kv.get('loyalty'), [])
  const loyaltyOn = loyaltyRow?.value === true

  const bottles = useLiveQuery(async () => {
    const code = store?.code ?? (await db.stores.filter((s) => s.isHub).first())?.code
    if (!code) return []
    const now = clock.now()
    const since = new Date(new Date(now).getTime() - 14 * DAY_MS).toISOString()
    const bills = await db.bills
      .where('[storeCode+at]')
      .between([code, since], [code, '￿'])
      .filter((b) => b.status === 'paid')
      .toArray()
    const billAt = new Map(bills.map((b) => [b.number, b.at]))
    const lines = await db.billLines.where('billNumber').anyOf([...billAt.keys()]).toArray()
    const ids = topSellers(
      lines.map((l) => ({ productId: l.productId, qty: l.qty, at: billAt.get(l.billNumber) ?? '', storeCode: code })),
      code,
      now,
    )
    const products = await db.products.bulkGet(ids)
    return products.flatMap((p) => (p ? [{ id: p.id, name: p.shortName, barcode: p.barcode }] : []))
  }, [store?.code])

  const setLoyalty = async (on: boolean): Promise<void> => {
    // Writes the stand-in server's config and the POS-side copy together.
    await setLoyaltyEnabled(on)
    requestLoyaltyRefresh()
  }

  const scan = (code: string): void => {
    closeDemoPanel()
    simulateScan(code)
  }

  const advance = async (): Promise<void> => {
    await advanceClock(db, 1)
    setToday(formatDate(clock.now()))
  }

  const reset = async (): Promise<void> => {
    setResetting(true)
    logout()
    navigate('/login', { replace: true })
    try {
      await resetDemo(db, seedOptions)
    } finally {
      setResetting(false)
      closeDemoPanel()
    }
  }

  return (
    <div className="demo-overlay">
      <div className="demo-panel" role="dialog" aria-label={t('demo.title')}>
        <header className="demo-head">
          <h2>{t('demo.title')}</h2>
          <button type="button" onClick={closeDemoPanel}>
            {t('demo.close')}
          </button>
        </header>

        <section className="demo-row" role="group" aria-label={t('demo.loyalty')}>
          <h3>{t('demo.loyalty')}</h3>
          <button type="button" aria-pressed={loyaltyOn} onClick={() => void setLoyalty(true)}>
            {t('demo.loyalty')} {t('demo.on')}
          </button>
          <button type="button" aria-pressed={!loyaltyOn} onClick={() => void setLoyalty(false)}>
            {t('demo.loyalty')} {t('demo.off')}
          </button>
        </section>

        <section className="demo-row" role="group" aria-label={t('demo.scan')}>
          <h3>{t('demo.scan')}</h3>
          <p>{t('demo.members')}</p>
          <div className="demo-buttons">
            {MEMBERS.map((m) => (
              <button key={m.code} type="button" onClick={() => scan(`TS1:${m.code}`)}>
                {m.name} {m.code}
              </button>
            ))}
          </div>
          <p>{t('demo.topSellers')}</p>
          {bottles && bottles.length === 0 && <p>{t('demo.noSales')}</p>}
          <div className="demo-buttons">
            {bottles?.map((b) => (
              <button key={b.id} type="button" onClick={() => scan(b.barcode)}>
                {b.name} {b.barcode}
              </button>
            ))}
          </div>
        </section>

        <section className="demo-row">
          <p>{t('demo.today', { date: today })}</p>
          <button type="button" onClick={() => void advance()}>
            {t('demo.advance')}
          </button>
        </section>

        <section className="demo-row">
          <button type="button" className="danger" disabled={resetting} onClick={() => void reset()}>
            {resetting ? t('demo.resetting') : t('demo.reset')}
          </button>
        </section>
      </div>
    </div>
  )
}
