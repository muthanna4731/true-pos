import { createContext, useContext } from 'react'
import type { ShopScope } from '../../domain/owner'
import type { Store } from '../../domain/types'
import type { OwnerTheme } from './theme'

export interface OwnerState {
  stores: Store[]
  /** One shop's code, or null for all shops. Every tab follows it. */
  scope: ShopScope
  setScope(scope: ShopScope): void
  /** "All shops", or the picked shop's name. */
  scopeName: string
  openPicker(): void
  theme: OwnerTheme
  pickTheme(theme: OwnerTheme): void
}

export const OwnerContext = createContext<OwnerState | null>(null)

export function useOwner(): OwnerState {
  const state = useContext(OwnerContext)
  if (!state) throw new Error('owner_context_missing')
  return state
}
