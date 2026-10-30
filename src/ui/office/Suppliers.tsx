import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db/db'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { nowMinute } from './shared'

/** KSBCL and the local suppliers: what was billed, what was paid, what is owed, and the history of each. */
export default function Suppliers() {
  useLang()
  const [picked, setPicked] = useState<string | null>(null)
  const now = nowMinute()
  const data = useLiveQuery(async () => {
    const [suppliers, grns, payments] = await Promise.all([db.suppliers.toArray(), db.grns.toArray(), db.supplierPayments.toArray()])
    return { suppliers, grns: grns.filter((g) => g.status === 'received'), payments }
  }, [])
  if (!data) return null

  const rows = data.suppliers.map((s) => {
    const billed = data.grns.filter((g) => g.supplierId === s.id).reduce((a, g) => a + g.invoiceAmount + g.tcs, 0)
    const paid = data.payments.filter((p) => p.supplierId === s.id).reduce((a, p) => a + p.amount, 0)
    return { id: s.id, name: s.name, billed, paid, owed: billed - paid }
  })
  const supplier = data.suppliers.find((s) => s.id === picked)
  const history = supplier
    ? [
        ...data.grns.filter((g) => g.supplierId === supplier.id).map((g) => ({ at: g.receivedAt, what: t('sup.invoice'), ref: g.invoiceNo, amount: g.invoiceAmount + g.tcs })),
        ...data.payments.filter((p) => p.supplierId === supplier.id).map((p) => ({ at: `${p.paidOn}T06:30:00.000Z`, what: t('sup.payment'), ref: p.ref, amount: -p.amount })),
      ].sort((a, b) => (a.at < b.at ? 1 : -1))
    : []

  return (
    <div className="suppliers">
      <PageHeader title={t('nav.suppliers')} backTo="/office" />
      <ReportTable
        title={t('nav.suppliers')}
        asOf={{ now }}
        columns={[
          { key: 'name', label: t('sup.name') },
          { key: 'billed', label: t('sup.billed'), kind: 'money' },
          { key: 'paid', label: t('sup.paid'), kind: 'money' },
          { key: 'owed', label: t('sup.owed'), kind: 'money' },
        ]}
        rows={rows}
        onRowClick={(r) => setPicked(String(r.id))}
      />
      {supplier && (
        <ReportTable
          title={t('sup.history', { name: supplier.name })}
          asOf={{ now }}
          columns={[
            { key: 'at', label: t('tr.date'), kind: 'date' },
            { key: 'what', label: t('stock.kind') },
            { key: 'ref', label: t('del.ref') },
            { key: 'amount', label: t('del.net'), kind: 'money' },
          ]}
          rows={history}
        />
      )}
    </div>
  )
}
