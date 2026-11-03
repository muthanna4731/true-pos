import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { loadShopSummaries } from '../../db/ownerData'
import { formatINR } from '../../domain/money'
import { nightlySummaryText } from '../../domain/owner'
import { clock, formatDate, istDate, istDayStart } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import Products from '../office/Products'
import { downloadDiscounts, downloadExcise, downloadValuation } from './downloads'
import Offers from './Offers'
import { Chevron, Empty, NameRow, Pill, SubPage } from './parts'
import { useDownload } from './useDownload'

/* The owner's existing tools, each inside the owner app with a way back to More. */

export function OffersPage() {
  useLang()
  return (
    <SubPage title={t('owner.offers')} sub={t('ow.offersSub')}>
      <div className="ow-page">
        <Offers />
      </div>
    </SubPage>
  )
}

export function PricesPage() {
  useLang()
  return (
    <SubPage title={t('owner.pushPrices')} sub={t('ow.pricesSub')}>
      <div className="ow-page">
        <Products />
      </div>
    </SubPage>
  )
}

/** The three CSV downloads. A download that fails says so; the next good one clears it. */
export function DownloadsPage() {
  useLang()
  const download = useDownload()
  const day = useLiveQuery(async () => (await loadShopSummaries(null)).day, [istDate(clock.now())])
  if (!day) return <SubPage title={t('owner.downloads')} sub={t('ow.downloadsSub')}>{null}</SubPage>
  const items = [
    { name: t('owner.dlExcise'), run: () => downloadExcise(day) },
    { name: t('owner.dlValuation'), run: () => downloadValuation(day) },
    { name: t('owner.dlDiscounts'), run: () => downloadDiscounts(day) },
  ]
  return (
    <SubPage title={t('owner.downloads')} sub={t('ow.downloadsSub')}>
      <div className="ow-list">
        {items.map((i) => (
          <button key={i.name} type="button" className="ow-rlink" onClick={() => download.run(i.run)}>
            <span className="ow-nm">
              <b>{i.name}</b>
            </span>
            <Chevron />
          </button>
        ))}
      </div>
      {download.error && <p className="ow-error" role="alert">{download.error}</p>}
    </SubPage>
  )
}

/** The nightly summary as plain text to copy. Nothing here sends it anywhere. */
export function SummaryPage() {
  useLang()
  const today = istDate(clock.now())
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const data = useLiveQuery(() => loadShopSummaries(picked), [picked, today])
  if (!data) return <SubPage title={t('ow.nightly')} sub={t('ow.nightlySub')}>{null}</SubPage>
  const text = nightlySummaryText(data.day, data.rows)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <SubPage title={t('ow.nightly')} sub={formatDate(istDayStart(data.day))}>
      <div className="ow-page">
        <label className="ow-dayrow">
          {t('owner.day')}
          <input type="date" value={data.day} max={today} onChange={(e) => e.target.value && setPicked(e.target.value)} />
        </label>
        <section className="ow-preview">
          <pre aria-label={t('owner.preview')}>{text}</pre>
          <button type="button" onClick={copy}>
            {copied ? t('owner.copied') : t('owner.copy')}
          </button>
        </section>
      </div>
    </SubPage>
  )
}

/** Each shop's day: sales, closed or not, cash short, low stock and short deliveries; and the chain month to date. */
export function ShopsPage() {
  useLang()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadShopSummaries(null), [today])
  if (!data) return <SubPage title={t('ow.shops')} sub={t('ow.shopsSub')}>{null}</SubPage>
  return (
    <SubPage title={t('ow.shops')} sub={formatDate(istDayStart(data.day))}>
      <div className="ow-list">
        {data.rows.length === 0 && <Empty>{t('ow.nothingToShow')}</Empty>}
        {data.rows.map((r) => (
          <NameRow
            key={r.storeCode}
            name={r.name}
            sub={
              <>
                <span className="ow-line">{`${t('owner.cash')} ${formatINR(r.byMode.cash)} · ${t('owner.upi')} ${formatINR(r.byMode.upi)} · ${t('owner.card')} ${formatINR(r.byMode.card)}`}</span>
                <span className="ow-line">{`${t('owner.bills')}: ${r.bills} · ${t('owner.cashShort')}: ${formatINR(r.cashShort)} · ${t('owner.lowStock')}: ${r.lowStock} · ${t('owner.deliveryShort')}: ${r.deliveryShort}`}</span>
              </>
            }
          >
            <span style={{ display: 'grid', justifyItems: 'end', gap: 5 }}>
              <span className="ow-amt">{formatINR(r.net)}</span>
              <Pill kind={r.closed ? 'ok' : 'low'}>{r.closed ? t('owner.closed') : t('owner.notClosed')}</Pill>
            </span>
          </NameRow>
        ))}
      </div>
      <div className="ow-list" style={{ marginTop: 12 }}>
        <NameRow name={t('owner.chainMtd')}>
          <span className="ow-amt">{formatINR(data.chain)}</span>
        </NameRow>
      </div>
    </SubPage>
  )
}
