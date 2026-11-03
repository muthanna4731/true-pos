import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { loadStock } from '../../db/ownerData'
import { formatINR, formatINRCompact } from '../../domain/money'
import { runningOut, sheetRows, stockTotals } from '../../domain/owner'
import { clock, formatDate, istDate, istDayStart } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { downloadStock } from './downloads'
import { useOwner } from './ownerContext'
import { Empty, NameRow, OwnerHeader, Pill, Section, Seg, shortDate, Totals } from './parts'
import { useDownload } from './useDownload'

const ATTENTION_SHOWN = 3
const SHEET_PAGE = 40

type Kind = 'all' | 'alc' | 'other'

/** Stock: value and counts, what needs attention, and the daily sheet (open, in, out, closing, MRP). */
export default function StockTab() {
  useLang()
  const { scope, scopeName, stores } = useOwner()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadStock(scope), [scope, today])
  const [kind, setKind] = useState<Kind>('all')
  const [allAttention, setAllAttention] = useState(false)
  const [shown, setShown] = useState(SHEET_PAGE)
  const download = useDownload()

  const view = useMemo(() => {
    if (!data || data.scope !== scope) return null
    return {
      totals: stockTotals(data.movements, data.landedOf, data.day, scope),
      out: runningOut(data.movements, clock.now(), data.day, scope),
      sheet: sheetRows(data.movements, data.products, data.mrpOf, data.day, scope, kind),
    }
  }, [data, scope, kind])

  if (!data || !view) return <div className="ow-app"><OwnerHeader title={t('ow.tab.stock')} sub={scopeName} /></div>
  const { totals, out, sheet } = view
  const name = (id: string): string => data.products.get(id)?.shortName || data.products.get(id)?.description || id
  const shop = (code: string): string => stores.find((s) => s.code === code)?.name ?? code
  const when = t(data.day === today ? 'ow.todayWord' : 'ow.yesterdayWord')
  const attention = allAttention ? out : out.slice(0, ATTENTION_SHOWN)

  return (
    <div className="ow-app">
      <OwnerHeader title={t('ow.tab.stock')} sub={`${scopeName} · ${shortDate(formatDate(istDayStart(data.day)))}`} />

      <Totals
        items={[
          { label: t('ow.stockValue'), value: formatINRCompact(totals.value), full: formatINR(totals.value) },
          { label: t('ow.itemsLabel'), value: String(totals.items) },
          { label: t('ow.lowOut'), value: String(out.length), color: out.length > 0 ? 'var(--amber)' : undefined },
        ]}
      />

      <Section
        title={t('ow.needsAttention')}
        action={
          out.length > ATTENTION_SHOWN ? (
            <button type="button" aria-expanded={allAttention} onClick={() => setAllAttention((v) => !v)}>
              {allAttention ? t('ow.fewer') : t('ow.allN', { n: out.length })}
            </button>
          ) : undefined
        }
      />
      <div className="ow-list">
        {out.length === 0 && <Empty>{t('ow.nothingOut')}</Empty>}
        {attention.map((r) => (
          <NameRow key={`${r.storeCode}|${r.productId}`} name={name(r.productId)} sub={`${scope === null ? `${shop(r.storeCode)} · ` : ''}${t('ow.soldN', { n: r.soldOnDay, when })}`}>
            <Pill kind={r.level}>{t('ow.left', { n: Math.max(0, r.onHand) })}</Pill>
          </NameRow>
        ))}
      </div>

      <Section
        title={t('ow.dailySheet')}
        action={
          <button type="button" onClick={() => download.run(() => downloadStock(data.day))}>
            {t('ow.export')}
          </button>
        }
      />
      {download.error && <p className="ow-error" role="alert">{download.error}</p>}
      <Seg
        label={t('ow.dailySheet')}
        value={kind}
        options={[
          { key: 'all', label: t('ow.seg.all') },
          { key: 'alc', label: t('ow.seg.alc') },
          { key: 'other', label: t('ow.seg.other') },
        ]}
        onChange={(k) => {
          setKind(k)
          setShown(SHEET_PAGE)
        }}
      />
      <div className="ow-list">
        {sheet.length === 0 && <Empty>{t('ow.nothingToShow')}</Empty>}
        {sheet.slice(0, shown).map((r) => (
          <div className="ow-ledger" key={r.productId}>
            <div className="top-line">
              <span className="item">{name(r.productId)}</span>
              <span className={r.closing <= 0 ? 'close zero' : 'close'}>{r.closing}</span>
            </div>
            <div className="ow-flow">
              <em>
                {t('ow.open')} <b>{r.opening}</b>
              </em>
              <em className="in">
                {t('ow.in')} <b>+{r.in}</b>
              </em>
              <em className="out">
                {t('ow.out')} <b>−{r.out}</b>
              </em>
              <em>
                {t('ow.mrp')} <b>{formatINR(r.mrp)}</b>
              </em>
            </div>
          </div>
        ))}
      </div>
      {sheet.length > shown && (
        <div className="ow-sec">
          <span />
          <button type="button" onClick={() => setShown((n) => n + SHEET_PAGE)}>
            {t('ow.showMore')}
          </button>
        </div>
      )}
    </div>
  )
}
