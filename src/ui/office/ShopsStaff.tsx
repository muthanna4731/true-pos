import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { useLoyaltyFlag } from '../../loyalty/flags'
import { shopLabel } from '../../domain/todos'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import ReportTable from '../common/ReportTable'
import PageHeader from '../manager/PageHeader'
import { nowMinute } from './shared'

/** Read-only: shops, staff with their roles, and the loyalty switch as Supabase has it. */
export default function ShopsStaff() {
  useLang()
  const loyalty = useLoyaltyFlag()
  const now = nowMinute()
  const data = useLiveQuery(async () => ({ stores: await db.stores.toArray(), users: await db.users.toArray() }), [])
  if (!data) return null
  const label = (code: string) => shopLabel(data.stores.find((s) => s.code === code), code)
  return (
    <div className="shops-staff">
      <PageHeader title={t('nav.shops')} backTo="/office" />
      <p>
        <strong>{loyalty ? t('shops.loyaltyOn') : t('shops.loyaltyOff')}</strong>
      </p>
      <p>{t('shops.loyaltyNote')}</p>
      <ReportTable
        title={t('shops.shops')}
        asOf={{ now }}
        columns={[
          { key: 'code', label: t('shops.code') },
          { key: 'label', label: t('orders.shop') },
          { key: 'name', label: t('sup.name') },
          { key: 'hub', label: t('shops.hub') },
          { key: 'licence', label: t('shops.licence') },
        ]}
        rows={data.stores.map((s) => ({ code: s.code, label: shopLabel(s, s.code), name: s.name, hub: s.isHub ? t('shops.yes') : '', licence: s.licenceNo }))}
      />
      <ReportTable
        title={t('shops.staff')}
        asOf={{ now }}
        columns={[
          { key: 'name', label: t('sup.name') },
          { key: 'role', label: t('shops.role') },
          { key: 'phone', label: t('shops.phone') },
          { key: 'shops', label: t('shops.shops') },
        ]}
        rows={data.users.map((u) => ({ name: u.name, role: t(`role.${u.role}`), phone: u.phone, shops: u.storeCodes.map(label).join(', ') }))}
      />
    </div>
  )
}
