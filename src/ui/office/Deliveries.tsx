import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../../db/db'
import { draftGrn, raiseClaim } from '../../db/stockOps'
import { formatINR } from '../../domain/money'
import { grnTotals, isOnOrder, KSBCL_INV_RE } from '../../domain/orders'
import { clock, formatDate } from '../../domain/time'
import { shopLabel } from '../../domain/todos'
import type { Claim, Grn, Price, Product, Store } from '../../domain/types'
import { t } from '../../i18n'
import ReportTable from '../common/ReportTable'
import { printAs } from '../common/print'
import PageHeader from '../manager/PageHeader'

type Tab = 'list' | 'returns' | 'local'

/** The printable note for a claim: what is short or broken on which invoice, and what it is worth. */
function ClaimNote({ grn, claims, products, store }: { grn: Grn; claims: Claim[]; products: Map<string, Product>; store: Store | undefined }) {
  const total = claims.reduce((s, c) => s + c.amount, 0)
  return (
    <section className="claim-note report report-print" aria-label={t('del.claimTitle')}>
      <h2>{t('del.claimTitle')}</h2>
      <p>{t('del.claimNo', { id: grn.id })}</p>
      <p>{t('del.claimText', { invoice: grn.invoiceNo, grn: grn.id, shop: shopLabel(store, grn.storeCode), date: formatDate(grn.receivedAt) })}</p>
      <table className="report-table">
        <thead>
          <tr>
            <th>{t('del.product')}</th>
            <th className="num">{t('del.qty')}</th>
            <th className="num">{t('del.lineAmount')}</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td>{products.get(c.productId)?.description ?? c.productId}</td>
              <td className="num">{c.qty}</td>
              <td className="num">{formatINR(c.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>{t('del.claimTotal')}</td>
            <td className="num">{formatINR(total)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="report-actions">
        <button type="button" onClick={() => printAs('report')}>
          {t('del.print')}
        </button>
      </div>
    </section>
  )
}

/** One delivery: its lines with the short and broken quantities, and [Raise claim] when something is wrong. */
function Detail({ grn, products, store, claims, onBack }: { grn: Grn; products: Map<string, Product>; store: Store | undefined; claims: Claim[]; onBack(): void }) {
  const [failed, setFailed] = useState(false)
  const bad = grn.lines.filter((l) => (l.short ?? 0) > 0 || (l.broken ?? 0) > 0)
  const filed = claims.filter((c) => c.status !== 'open')
  const allFiled = bad.every((l) => filed.some((c) => c.productId === l.productId))

  const raise = async (): Promise<void> => {
    setFailed(false)
    try {
      await raiseClaim(grn.id)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="delivery-detail">
      <button type="button" className="link-button" onClick={onBack}>
        ← {t('del.back')}
      </button>
      <h2>
        {grn.id} · {grn.invoiceNo}
      </h2>
      <table className="report-table">
        <thead>
          <tr>
            <th>{t('del.category')}</th>
            <th>{t('del.product')}</th>
            <th className="num">{t('del.qty')}</th>
            <th className="num">{t('del.counted')}</th>
            <th className="num">{t('del.short')}</th>
            <th className="num">{t('del.broken')}</th>
            <th className="num">{t('del.price')}</th>
            <th className="num">{t('del.lineAmount')}</th>
          </tr>
        </thead>
        <tbody>
          {grn.lines.map((l) => {
            const p = products.get(l.productId)
            return (
              <tr key={l.productId}>
                <td>{p?.subcategory ?? ''}</td>
                <td>{p?.shortName ?? l.productId}</td>
                <td className="num">{l.expected}</td>
                <td className="num">{l.counted ?? ''}</td>
                <td className="num">{l.short ?? ''}</td>
                <td className="num">{l.broken ?? ''}</td>
                <td className="num">{formatINR(l.unitPrice)}</td>
                <td className="num">{formatINR(l.expected * l.unitPrice)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {bad.length > 0 && !allFiled && (
        <button type="button" onClick={() => void raise()}>
          {t('del.raise')}
        </button>
      )}
      {failed && <p role="alert" className="field-error">{t('orders.failed')}</p>}
      {filed.length > 0 && <ClaimNote grn={grn} claims={filed} products={products} store={store} />}
    </div>
  )
}

/** Enter the invoice KSBCL sent for a placed order; the shop then counts it at the door. */
function NewDelivery({ indentIds }: { indentIds: string[] }) {
  const [indentId, setIndentId] = useState('')
  const [invoice, setInvoice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chosen = indentId || indentIds[0] || ''

  if (indentIds.length === 0) return <p>{t('del.noOrders')}</p>

  const add = async (): Promise<void> => {
    const number = invoice.trim().toUpperCase()
    if (!KSBCL_INV_RE.test(number)) {
      setError(t('del.badInvoice'))
      return
    }
    setError(null)
    try {
      await draftGrn(chosen, number)
      setInvoice('')
    } catch {
      setError(t('orders.failed'))
    }
  }

  return (
    <fieldset className="new-delivery">
      <legend>{t('del.new')}</legend>
      <label>
        {t('del.pickIndent')}{' '}
        <select value={chosen} onChange={(e) => setIndentId(e.target.value)}>
          {indentIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <input aria-label={t('del.invoice')} placeholder="SMYH26009086" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
      <button type="button" onClick={() => void add()}>
        {t('del.add')}
      </button>
      {error && <p role="alert" className="field-error">{error}</p>}
    </fieldset>
  )
}

/** Goods received: the list with GRN, indent, invoice, AROED, TCS and total; each delivery's detail; Returns; Local suppliers. */
export default function Deliveries() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('list')
  const selected = params.get('grn')
  const now = clock.now()

  const data = useLiveQuery(async () => {
    const [stores, products, grns, prices, claims, indents, suppliers, returns] = await Promise.all([
      db.stores.toArray(),
      db.products.toArray(),
      db.grns.toArray(),
      db.prices.toArray(),
      db.claims.toArray(),
      db.indents.toArray(),
      db.suppliers.toArray(),
      db.movements.where('kind').equals('purchase_return').toArray(),
    ])
    return { stores, products, grns, prices: prices as Price[], claims, indents, suppliers, returns }
  }, [])

  if (!data) return null
  const storeBy = new Map(data.stores.map((s) => [s.code, s]))
  const productBy = new Map(data.products.map((p) => [p.id, p]))
  const shop = (code: string): string => shopLabel(storeBy.get(code), code)
  const ksbcl = data.grns.filter((g) => g.type === 'ksbcl').sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
  const grn = selected ? data.grns.find((g) => g.id === selected) : undefined

  const withIndent = new Set(data.grns.flatMap((g) => (g.indentId ? [g.indentId] : [])))
  const waiting = data.indents.filter((i) => isOnOrder(i) && !withIndent.has(i.id)).map((i) => i.id)

  const tabs: [Tab, string][] = [
    ['list', 'del.tabList'],
    ['returns', 'del.tabReturns'],
    ['local', 'del.tabLocal'],
  ]

  return (
    <div className="deliveries">
      <PageHeader title={t('del.title')} backTo="/office" />
      <div role="tablist" className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'list' && grn && (
        <Detail grn={grn} products={productBy} store={storeBy.get(grn.storeCode)} claims={data.claims.filter((c) => c.grnId === grn.id)} onBack={() => setParams({})} />
      )}
      {tab === 'list' && !grn && (
        <>
          <NewDelivery indentIds={waiting} />
          {ksbcl.length === 0 ? (
            <p>{t('del.none')}</p>
          ) : (
            <table className="report-table deliveries-table">
              <thead>
                <tr>
                  <th>{t('del.grn')}</th>
                  <th>{t('del.date')}</th>
                  <th>{t('del.shop')}</th>
                  <th>{t('del.indent')}</th>
                  <th>{t('del.invoice')}</th>
                  <th className="num">{t('del.amount')}</th>
                  <th className="num">{t('del.aroed')}</th>
                  <th className="num">{t('del.tcs')}</th>
                  <th className="num">{t('del.total')}</th>
                </tr>
              </thead>
              <tbody>
                {ksbcl.map((g) => {
                  const { aroed, total } = grnTotals(g, data.prices)
                  return (
                    <tr key={g.id}>
                      <td>
                        <button type="button" className="link-button" onClick={() => setParams({ grn: g.id })}>
                          {g.id}
                        </button>
                        {g.status === 'draft' && <small> {t('del.toCount')}</small>}
                      </td>
                      <td>{formatDate(g.receivedAt)}</td>
                      <td>{shop(g.storeCode)}</td>
                      <td>{g.indentId ?? ''}</td>
                      <td>{g.invoiceNo}</td>
                      <td className="num">{formatINR(g.invoiceAmount)}</td>
                      <td className="num">{formatINR(aroed)}</td>
                      <td className="num">{formatINR(g.tcs)}</td>
                      <td className="num">{formatINR(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'returns' && (
        <ReportTable
          title={t('del.returnsTitle')}
          asOf={{ now }}
          columns={[
            { key: 'ref', label: t('del.ref') },
            { key: 'at', label: t('del.date'), kind: 'date' },
            { key: 'shop', label: t('del.shop') },
            { key: 'product', label: t('del.product') },
            { key: 'qty', label: t('del.qty'), kind: 'number' },
          ]}
          rows={data.returns.map((m) => ({ ref: m.ref, at: m.at, shop: shop(m.storeCode), product: productBy.get(m.productId)?.shortName ?? m.productId, qty: Math.abs(m.qty) }))}
        />
      )}

      {tab === 'local' && (
        <ReportTable
          title={t('del.localTitle')}
          asOf={{ now }}
          columns={[
            { key: 'supplier', label: t('del.supplier') },
            { key: 'invoice', label: t('del.invoice') },
            { key: 'at', label: t('del.date'), kind: 'date' },
            { key: 'gross', label: t('del.gross'), kind: 'money' },
            { key: 'tax', label: t('del.tax'), kind: 'money' },
            { key: 'net', label: t('del.net'), kind: 'money' },
          ]}
          rows={data.grns
            .filter((g) => g.type === 'other')
            .map((g) => ({
              supplier: data.suppliers.find((s) => s.id === g.supplierId)?.name ?? g.supplierId,
              invoice: g.invoiceNo,
              at: g.receivedAt,
              gross: g.invoiceAmount,
              tax: g.tcs,
              net: g.invoiceAmount + g.tcs,
            }))}
        />
      )}
    </div>
  )
}
