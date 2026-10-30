import { Navigate, Route, Routes } from 'react-router-dom'
import { t } from '../../i18n'
import RoleGate from '../shell/RoleGate'
import RoleScreen from '../shell/RoleScreen'
import PageHeader from '../manager/PageHeader'
import Deliveries from './Deliveries'
import OfficeHome from './OfficeHome'
import Orders from './Orders'

/** A screen a later task builds: a title and a note, so every link of the office home goes somewhere. */
function Later({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} backTo="/office" />
      <p>{t('office.soon')}</p>
    </>
  )
}

const LATER: [string, string][] = [
  ['transfers', 'nav.transfers'],
  ['stock', 'nav.stock'],
  ['losses', 'nav.losses'],
  ['suppliers', 'nav.suppliers'],
  ['products', 'nav.products'],
  ['reports', 'nav.reports'],
  ['shops', 'nav.shops'],
]

/** Everything under /office: the to-do home, orders, deliveries, and placeholders for the screens still to come. */
export default function OfficeRoutes() {
  return (
    <RoleGate allow={['office']}>
      <RoleScreen>
        <Routes>
          <Route index element={<OfficeHome />} />
          <Route path="orders" element={<Orders />} />
          <Route path="deliveries" element={<Deliveries />} />
          {LATER.map(([path, label]) => (
            <Route key={path} path={path} element={<Later title={t(label)} />} />
          ))}
          <Route path="*" element={<Navigate to="/office" replace />} />
        </Routes>
      </RoleScreen>
    </RoleGate>
  )
}
