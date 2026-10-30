import { Navigate, Route, Routes } from 'react-router-dom'
import RoleGate from '../shell/RoleGate'
import RoleScreen from '../shell/RoleScreen'
import BillsList from './BillsList'
import CloseShiftPage from './CloseShiftPage'
import CountShelf from './CountShelf'
import ManagerHome from './ManagerHome'
import StockArrived from './StockArrived'

/** Everything under /manager: the home with its three big buttons, and the four screens they open. */
export default function ManagerRoutes() {
  return (
    <RoleGate allow={['manager']}>
      <RoleScreen>
        <Routes>
          <Route index element={<ManagerHome />} />
          <Route path="stock" element={<StockArrived />} />
          <Route path="count" element={<CountShelf />} />
          <Route path="close" element={<CloseShiftPage />} />
          <Route path="bills" element={<BillsList />} />
          <Route path="*" element={<Navigate to="/manager" replace />} />
        </Routes>
      </RoleScreen>
    </RoleGate>
  )
}
