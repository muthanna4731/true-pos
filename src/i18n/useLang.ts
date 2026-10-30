import { useSyncExternalStore } from 'react'
import { getLang, subscribeLang, type Lang } from './index'

/**
 * Re-render when the language changes. The app root calls this so every screen below it
 * picks up new strings; a component wrapped in React.memo must call it itself.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang)
}
