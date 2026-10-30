import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Role } from '../../domain/types'
import { homeFor } from './homes'
import { useSession } from './session'

/** Shows its children only to the listed roles. Someone logged out goes to login; someone else goes to their own home. */
export default function RoleGate({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user } = useSession()
  if (!user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}
