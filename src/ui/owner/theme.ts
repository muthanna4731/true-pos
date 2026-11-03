import { useEffect, useState } from 'react'

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

const darkQuery = (): MediaQueryList | null => {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  } catch {
    return null
  }
}

/**
 * Day or night for the owner app. It follows the device (`prefers-color-scheme`) until the owner picks one;
 * the pick is remembered in localStorage (and the app still works where storage is blocked).
 */
export function useOwnerTheme(): { theme: OwnerTheme; pick(theme: OwnerTheme): void } {
  const [picked, setPicked] = useState<OwnerTheme | null>(stored)
  const [system, setSystem] = useState<OwnerTheme>(() => (darkQuery()?.matches ? 'dark' : 'light'))

  useEffect(() => {
    const query = darkQuery()
    if (!query) return
    const onChange = (e: MediaQueryListEvent): void => setSystem(e.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const pick = (theme: OwnerTheme): void => {
    setPicked(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // The pick just won't be remembered.
    }
  }
  return { theme: picked ?? system, pick }
}
