import type { Role } from '../../domain/types'

/** Where each role lands after login. */
export function homeFor(role: Role): string {
  switch (role) {
    case 'cashier':
      return '/bill'
    case 'manager':
      return '/manager'
    case 'office':
      return '/office'
    case 'owner':
      return '/owner'
  }
}
