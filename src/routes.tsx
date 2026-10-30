import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from './domain/types'
import { t } from './i18n'
import { useLang } from './i18n/useLang'
import { useLoyaltyFlag } from './loyalty/flags'
import BillScreen from './ui/bill/BillScreen'
import ManagerRoutes from './ui/manager/ManagerRoutes'
import DemoPanel from './ui/shell/DemoPanel'
import Login from './ui/shell/Login'
import RoleGate from './ui/shell/RoleGate'
import RoleScreen from './ui/shell/RoleScreen'

/** A role screen that later tasks fill in: the gate, the header with language toggle and sync badge, and a title. */
function Screen({ allow, title, children }: { allow: Role[]; title: string; children?: ReactNode }) {
  return (
    <RoleGate allow={allow}>
      <RoleScreen>
        <h1>{title}</h1>
        {children ?? <p>{t('comingSoon')}</p>}
      </RoleScreen>
    </RoleGate>
  )
}

/** Every route of the app. Needs a router above it. */
export function AppRoutes() {
  useLang() // re-render the whole tree when the language changes
  useLoyaltyFlag() // keeps the loyalty switch fresh: at start, after login and every 5 minutes

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/bill"
          element={
            <RoleGate allow={['cashier', 'manager']}>
              <RoleScreen wide>
                <BillScreen />
              </RoleScreen>
            </RoleGate>
          }
        />
        <Route path="/manager/*" element={<ManagerRoutes />} />
        <Route path="/office/*" element={<Screen allow={['office']} title={t('home.office')} />} />
        <Route path="/owner" element={<Screen allow={['owner']} title={t('home.owner')} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <DemoPanel />
    </>
  )
}
