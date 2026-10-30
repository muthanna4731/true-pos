import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db/db'
import { draftGrn } from '../../db/stockOps'
import { formatDate } from '../../domain/time'
import { t } from '../../i18n'
import { useSession } from '../shell/session'
import PageHeader from './PageHeader'
import ReceiveGrn from './ReceiveGrn'

/** What a KSBCL invoice number looks like: SMYH26 and six digits. */
const INVOICE_RE = /^SMYH26\d{6}$/

type View = { kind: 'list' } | { kind: 'invoice'; indentId: string } | { kind: 'receive'; grnId: string }

/**
 * Deliveries waiting at this shop: invoices already entered and not yet counted, and placed orders whose
 * invoice has not been entered (the manager types it with [Enter invoice]).
 */
export default function StockArrived() {
  const { store } = useSession()
  const code = store?.code
  const [view, setView] = useState<View>({ kind: 'list' })
  const [notice, setNotice] = useState<string | null>(null)

  const waiting = useLiveQuery(async () => {
    if (!code) return undefined
    const grns = await db.grns.where('storeCode').equals(code).toArray()
    const invoiced = new Set(grns.flatMap((g) => (g.indentId ? [g.indentId] : [])))
    const indents = await db.indents.where('storeCode').equals(code).filter((i) => i.status === 'placed' && !invoiced.has(i.id)).toArray()
    return { drafts: grns.filter((g) => g.status === 'draft'), indents }
  }, [code])

  const grn = useLiveQuery(async () => (view.kind === 'receive' ? ((await db.grns.get(view.grnId)) ?? null) : undefined), [view.kind === 'receive' ? view.grnId : ''])

  const back = (): void => setView({ kind: 'list' })

  if (view.kind === 'receive') {
    return (
      <>
        <PageHeader title={t('mgr.stockArrived')} />
        {grn && grn.status === 'draft' && (
          <ReceiveGrn
            grn={grn}
            onSaved={() => {
              setNotice(t('stock.saved'))
              back()
            }}
          />
        )}
        <button type="button" className="link-button" onClick={back}>
          {t('back')}
        </button>
      </>
    )
  }

  if (view.kind === 'invoice') {
    return (
      <>
        <PageHeader title={t('mgr.stockArrived')} />
        <InvoiceForm
          indentId={view.indentId}
          onCreated={(grnId) => setView({ kind: 'receive', grnId })}
          onBack={back}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('mgr.stockArrived')} />
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {waiting && waiting.drafts.length === 0 && waiting.indents.length === 0 && <p className="empty">{t('stock.empty')}</p>}
      <ul className="waiting-list">
        {waiting?.drafts.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              className="waiting-row"
              onClick={() => {
                setNotice(null)
                setView({ kind: 'receive', grnId: g.id })
              }}
            >
              <strong>{t('stock.invoice', { no: g.invoiceNo })}</strong>
              <span>{formatDate(g.receivedAt)}</span>
              <span>{t('stock.countIt')}</span>
            </button>
          </li>
        ))}
        {waiting?.indents.map((i) => (
          <li key={i.id} className="waiting-row">
            <strong>{t('stock.order', { id: i.id })}</strong>
            <span>{formatDate(i.placedAt)}</span>
            <button
              type="button"
              onClick={() => {
                setNotice(null)
                setView({ kind: 'invoice', indentId: i.id })
              }}
            >
              {t('stock.enterInvoice')}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Type the invoice number of an order that has arrived. [Next] makes the delivery to count. */
function InvoiceForm({ indentId, onCreated, onBack }: { indentId: string; onCreated(grnId: string): void; onBack(): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const next = async (): Promise<void> => {
    const no = text.trim().toUpperCase()
    if (!INVOICE_RE.test(no)) {
      setError(t('stock.invoiceBad'))
      return
    }
    try {
      onCreated(await draftGrn(indentId, no))
    } catch {
      setError(t('stock.failed'))
    }
  }

  return (
    <section className="invoice-form">
      <label>
        {t('stock.invoiceNo')}
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="SMYH26000000"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
      </label>
      {error !== null && (
        <p className="pay-error" role="alert">
          {error}
        </p>
      )}
      <div className="pay-actions">
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
        <button type="button" className="pay-primary" onClick={() => void next()}>
          {t('stock.next')}
        </button>
      </div>
    </section>
  )
}
