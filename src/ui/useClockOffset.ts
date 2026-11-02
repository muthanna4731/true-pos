import { useSyncExternalStore } from 'react'
import { clock } from '../domain/time'

/**
 * Re-render when the demo clock moves (the demo panel's "Next day"). The app root calls this so every
 * screen below it reads "today" again; a component wrapped in React.memo must call it itself.
 */
export function useClockOffset(): number {
  return useSyncExternalStore(clock.subscribe, clock.offsetDays)
}
