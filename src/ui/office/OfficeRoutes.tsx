import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { t } from '../../i18n'
import BillsList from '../manager/BillsList'
import CloseShiftPage from '../manager/CloseShiftPage'
import CountShelf from '../manager/CountShelf'
import PageHeader from '../manager/PageHeader'
import StockArrived from '../manager/StockArrived'
import Offers from '../owner/Offers'
import RoleGate from '../shell/RoleGate'
import RoleScreen from '../shell/RoleScreen'
import Deliveries from './Deliveries'
import Losses from './Losses'
import OfficeHome from './OfficeHome'
import Orders from './Orders'
import Products from './Products'
import Reports from './Reports'
import ShopScope from './ShopScope'
import ShopsStaff from './ShopsStaff'
import StockView from './StockView'
import Suppliers from './Suppliers'
import Transfers from './Transfers'

/** A page only the manager may open: anyone else lands back on their own home. */
const managerOnly = (page: ReactNode): ReactNode => <RoleGate allow={['manager']}>{page}</RoleGate>

/**
 * Everything under /office, the one back-office app of Office and Manager: the to-do home and each screen its tabs
 * lead to. The manager also opens close shift, bills, offers and shops & staff. Those routes are gated to the manager,
 * and navItems.ts keeps the same four out of the office's links.
 */
export default function OfficeRoutes() {
  return (
    <RoleGate allow={['office', 'manager']}>
      <RoleScreen>
        <Routes>
          <Route index element={<OfficeHome />} />
          <Route path="orders" element={<Orders />} />
          <Route path="deliveries" element={<Deliveries />} />
          <Route path="transfers" element={<Transfers />} />
          <Route path="stock" element={<StockView />} />
          <Route path="arrived" element={<ShopScope>{(store) => <StockArrived store={store} />}</ShopScope>} />
          <Route path="count" element={<ShopScope>{(store) => <CountShelf store={store} />}</ShopScope>} />
          <Route path="losses" element={<Losses />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="products" element={<Products />} />
          <Route path="reports" element={<Reports />} />
          <Route path="close" element={managerOnly(<ShopScope>{(store) => <CloseShiftPage store={store} />}</ShopScope>)} />
          <Route
            path="bills"
            element={managerOnly(
              <ShopScope>
                {(store) => <BillsList store={store} />}
              </ShopScope>,
            )}
          />
          <Route
            path="offers"
            element={managerOnly(
              <>
                <PageHeader title={t('nav.offers')} />
                <Offers />
              </>,
            )}
          />
          <Route path="shops" element={managerOnly(<ShopsStaff />)} />
          <Route path="*" element={<Navigate to="/office" replace />} />
        </Routes>
      </RoleScreen>
    </RoleGate>
  )
}
