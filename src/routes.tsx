import { Navigate, Route, Routes } from 'react-router-dom'
import { useLang } from './i18n/useLang'
import { useClockOffset } from './ui/useClockOffset'
import { useLoyaltyFlag } from './loyalty/flags'
import BillScreen from './ui/bill/BillScreen'
import OfficeRoutes from './ui/office/OfficeRoutes'
import MoreTab from './ui/owner/MoreTab'
import OwnerApp from './ui/owner/OwnerApp'
import Purchases from './ui/owner/Purchases'
import Reports from './ui/owner/Reports'
import SalesTab from './ui/owner/SalesTab'
import StockTab from './ui/owner/StockTab'
import TodayTab from './ui/owner/TodayTab'
import { DownloadsPage, OffersPage, PricesPage, ShopsPage, SummaryPage } from './ui/owner/ToolPages'
import DemoPanel from './ui/shell/DemoPanel'
import Login from './ui/shell/Login'
import RoleGate from './ui/shell/RoleGate'
import RoleScreen from './ui/shell/RoleScreen'

/** Every route of the app. Needs a router above it. */
export function AppRoutes() {
  useLang() // re-render the whole tree when the language changes
  useClockOffset() // and when the demo clock moves to another day, so "day closed" and "today" follow it
  useLoyaltyFlag() // keeps the loyalty switch fresh: at start, after login and every 5 minutes

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/bill"
          element={
            <RoleGate allow={['cashier']}>
              <RoleScreen wide>
                <BillScreen />
              </RoleScreen>
            </RoleGate>
          }
        />
        <Route path="/manager/*" element={<Navigate to="/office" replace />} />
        <Route path="/office/*" element={<OfficeRoutes />} />
        <Route
          path="/owner"
          element={
            <RoleGate allow={['owner']}>
              <OwnerApp />
            </RoleGate>
          }
        >
          <Route index element={<TodayTab />} />
          <Route path="sales" element={<SalesTab />} />
          <Route path="stock" element={<StockTab />} />
          <Route path="more" element={<MoreTab />} />
          <Route path="more/purchases" element={<Purchases />} />
          <Route path="more/reports" element={<Reports />} />
          <Route path="more/offers" element={<OffersPage />} />
          <Route path="more/downloads" element={<DownloadsPage />} />
          <Route path="more/summary" element={<SummaryPage />} />
          <Route path="more/shops" element={<ShopsPage />} />
          <Route path="prices" element={<PricesPage />} />
          <Route path="*" element={<Navigate to="/owner" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <DemoPanel />
    </>
  )
}
