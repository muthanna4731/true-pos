import en from './en.json'
import kn from './kn.json'

export type Lang = 'en' | 'kn'

const dictionaries: Record<Lang, Record<string, string>> = { en, kn }

const STORAGE_KEY = 'lang'

let current: Lang = 'en'
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

/** Call `listener` after every language change. Returns the unsubscribe function. */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function apply(lang: Lang): void {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of listeners) listener()
}

/** Switch language, tell the screens, and remember the choice for next time. */
export function setLang(lang: Lang): void {
  apply(lang)
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Private mode or blocked storage: the choice just won't be remembered.
  }
}

/** Use the language remembered from last time, if any. Call once at start-up. */
export function restoreLang(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'kn') apply(saved)
  } catch {
    // Nothing remembered.
  }
}

/** Look up a string and fill `{name}` placeholders. Unknown keys return the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = dictionaries[current][key] ?? dictionaries.en[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}
