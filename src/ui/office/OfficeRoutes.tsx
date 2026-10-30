import { Navigate, Route, Routes } from 'react-router-dom'
import RoleGate from '../shell/RoleGate'
import RoleScreen from '../shell/RoleScreen'
import Deliveries from './Deliveries'
import Losses from './Losses'
import OfficeHome from './OfficeHome'
import Orders from './Orders'
import Products from './Products'
import Reports from './Reports'
import ShopsStaff from './ShopsStaff'
import StockView from './StockView'
import Suppliers from './Suppliers'
import Transfers from './Transfers'

/** Everything under /office: the to-do home and each screen its tabs lead to. */
export default function OfficeRoutes() {
  return (
    <RoleGate allow={['office']}>
      <RoleScreen>
        <Routes>
          <Route index element={<OfficeHome />} />
          <Route path="orders" element={<Orders />} />
          <Route path="deliveries" element={<Deliveries />} />
          <Route path="transfers" element={<Transfers />} />
          <Route path="stock" element={<StockView />} />
          <Route path="losses" element={<Losses />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="products" element={<Products />} />
          <Route path="reports" element={<Reports />} />
          <Route path="shops" element={<ShopsStaff />} />
          <Route path="*" element={<Navigate to="/office" replace />} />
        </Routes>
      </RoleScreen>
    </RoleGate>
  )
}
