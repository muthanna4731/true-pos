import en from './en.json'
import kn from './kn.json'

export type Lang = 'en' | 'kn'

const dictionaries: Record<Lang, Record<string, string>> = { en, kn }

let current: Lang = 'en'

export function setLang(lang: Lang): void {
  current = lang
}

/** Look up a string and fill `{name}` placeholders. Unknown keys return the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = dictionaries[current][key] ?? dictionaries.en[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}
