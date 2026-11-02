import { Navigate, Route, Routes } from 'react-router-dom'
import { t } from './i18n'
import { useLang } from './i18n/useLang'
import { useClockOffset } from './ui/useClockOffset'
import { useLoyaltyFlag } from './loyalty/flags'
import BillScreen from './ui/bill/BillScreen'
import OfficeRoutes from './ui/office/OfficeRoutes'
import Products from './ui/office/Products'
import OwnerPage from './ui/owner/OwnerPage'
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
              <RoleScreen>
                <h1>{t('home.owner')}</h1>
                <OwnerPage />
              </RoleScreen>
            </RoleGate>
          }
        />
        <Route
          path="/owner/prices"
          element={
            <RoleGate allow={['owner']}>
              <RoleScreen>
                <Products />
              </RoleScreen>
            </RoleGate>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <DemoPanel />
    </>
  )
}
