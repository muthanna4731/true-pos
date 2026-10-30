import { createContext, useContext, useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function openDemoPanel(): void {
  set(true)
}

export function closeDemoPanel(): void {
  set(false)
}

export function useDemoPanelOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => open,
  )
}

const TAPS = 3
const WITHIN_MS = 1000
let taps: number[] = []

/** Three taps on the logo within one second open the demo panel. */
export function registerLogoTap(now: number = Date.now()): void {
  taps = [...taps.filter((t) => now - t < WITHIN_MS), now]
  if (taps.length >= TAPS) {
    taps = []
    openDemoPanel()
  }
}

/** How the demo seed is loaded, so "Reset demo data" reloads it the same way (tests pass a short history). */
export const SeedOptionsContext = createContext<{ seed?: number; days?: number }>({})

export function useSeedOptions(): { seed?: number; days?: number } {
  return useContext(SeedOptionsContext)
}
