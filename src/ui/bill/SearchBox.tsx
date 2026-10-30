import { t } from '../../i18n'

interface Props {
  value: string
  onChange(value: string): void
}

/** Type what people say ("oc 90"). Nothing needs to be focused for the scanner to work, so this is never auto-focused. */
export default function SearchBox({ value, onChange }: Props) {
  return (
    <input
      type="text"
      className="search-box"
      aria-label={t('bill.search')}
      placeholder={t('bill.search')}
      value={value}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
