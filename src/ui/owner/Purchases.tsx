import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { loadPurchases } from '../../db/ownerData'
import { formatINR, formatINRCompact } from '../../domain/money'
import { purchasesSummary, type TransferRow } from '../../domain/owner'
import { clock, formatDate, istDate } from '../../domain/time'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { useOwner } from './ownerContext'
import { Empty, NameRow, Pill, Section, Seg, SubPage, shortDate, Totals } from './parts'

type Tab = 'alcohol' | 'nonAlcohol' | 'transfers'
const TRANSFERS_SHOWN = 3
const RECEIPTS_SHOWN = 6

/** Purchases (under More): the month's deliveries in cases, stock transfers as plus and minus, and the top suppliers. */
export default function Purchases() {
  useLang()
  const { scope, scopeName, stores } = useOwner()
  const today = istDate(clock.now())
  const data = useLiveQuery(() => loadPurchases(scope), [scope, today])
  const [tab, setTab] = useState<Tab>('alcohol')

  const sum = useMemo(
    () => (data && data.scope === scope ? purchasesSummary({ grns: data.grns, transfers: data.transfers, products: data.products, suppliers: data.suppliers, scope, month: data.day.slice(0, 7) }) : null),
    [data, scope],
  )
  const sub = `${scopeName} · ${t('ow.thisMonth')}`
  if (!data || !sum) return <SubPage title={t('ow.purchases')} sub={sub} picker />

  const shop = (code: string): string => stores.find((s) => s.code === code)?.name ?? code
  const dateOf = (iso: string): string => shortDate(formatDate(iso))
  const count = (n: number, one: string, many: string): string => t(n === 1 ? one : many, { n })
  const productName = (id: string): string => data.products.get(id)?.shortName || data.products.get(id)?.description || id

  const receipts = sum.receipts.filter((r) => (tab === 'alcohol' ? r.alcohol : !r.alcohol))
  const receiptRows = receipts.slice(0, RECEIPTS_SHOWN).map((r) => (
    <NameRow
      key={r.id}
      name={t('ow.grnRow', { date: dateOf(r.at), no: r.invoiceNo || r.id })}
      sub={`${r.productId ? productName(r.productId) : t('ow.mixed')} · ${count(r.cases, 'ow.caseOne', 'ow.caseMany')}`}
    >
      <span className="ow-amt">{formatINR(r.amount)}</span>
    </NameRow>
  ))

  const transferRow = (r: TransferRow) => {
    const qty = r.direction === 'out' ? `−${r.qty}` : r.direction === 'in' ? `+${r.qty}` : String(r.qty)
    const name = r.direction === 'out' ? t('ow.toShop', { shop: shop(r.toStore) }) : r.direction === 'in' ? t('ow.fromShop', { shop: shop(r.fromStore) }) : `${shop(r.fromStore)} → ${shop(r.toStore)}`
    return (
      <NameRow key={r.id} name={name} sub={dateOf(r.at)}>
        <Pill kind={r.direction === 'out' ? 'low' : r.direction === 'in' ? 'ok' : 'flat'}>{qty}</Pill>
      </NameRow>
    )
  }
  const transferList = (rows: TransferRow[]) => <div className="ow-list">{rows.length === 0 ? <Empty>{t('ow.noTransfers')}</Empty> : rows.map(transferRow)}</div>

  return (
    <SubPage title={t('ow.purchases')} sub={sub} picker>
      <Totals
        items={[
          { label: t('ow.ksbcl'), value: formatINRCompact(sum.ksbcl), full: formatINR(sum.ksbcl) },
          { label: t('ow.otherVendors'), value: formatINRCompact(sum.other), full: formatINR(sum.other) },
          { label: t('ow.entries'), value: String(sum.entries) },
        ]}
      />

      <div style={{ marginTop: 12 }}>
        <Seg
          label={t('ow.purchases')}
          value={tab}
          options={[
            { key: 'alcohol', label: t('ow.seg.alcohol') },
            { key: 'nonAlcohol', label: t('ow.seg.nonAlcohol') },
            { key: 'transfers', label: t('ow.seg.transfers') },
          ]}
          onChange={setTab}
        />
      </div>

      {tab !== 'transfers' && (
        <>
          <Section title={t(tab === 'alcohol' ? 'ow.ksbclReceipts' : 'ow.otherReceipts')} />
          <div className="ow-list">
            {receiptRows.length === 0 && <Empty>{t('ow.noReceipts')}</Empty>}
            {receiptRows}
          </div>
        </>
      )}

      {tab !== 'nonAlcohol' && (
        <>
          <Section title={t('ow.stockTransfers')} />
          {transferList(tab === 'alcohol' ? sum.transfers.slice(0, TRANSFERS_SHOWN) : sum.transfers.slice(0, 30))}
        </>
      )}

      {tab !== 'transfers' && (
        <>
          <Section title={t('ow.topSuppliers')} />
          <div className="ow-list">
            {sum.suppliers.length === 0 && <Empty>{t('ow.noSuppliers')}</Empty>}
            {sum.suppliers.slice(0, 3).map((s, i) => (
              <NameRow key={s.supplierId} rank={i + 1} name={s.name} sub={count(s.receipts, 'ow.receiptOne', 'ow.receiptMany')}>
                <span className="ow-amt">{formatINR(s.amount)}</span>
              </NameRow>
            ))}
          </div>
        </>
      )}
    </SubPage>
  )
}
