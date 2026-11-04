import { useState } from 'react'

export type OwnerTheme = 'light' | 'dark'

const KEY = 'ownerTheme'

function stored(): OwnerTheme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/**
 * Day or night for the owner app. It opens in day (light) until the owner picks night; the pick is remembered in
 * localStorage (and the app still works where storage is blocked).
 */
export function useOwnerTheme(): { theme: OwnerTheme; pick(theme: OwnerTheme): void } {
  const [picked, setPicked] = useState<OwnerTheme | null>(stored)

  const pick = (theme: OwnerTheme): void => {
    setPicked(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // The pick just won't be remembered.
    }
  }
  return { theme: picked ?? 'light', pick }
}
