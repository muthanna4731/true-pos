import { getLang, setLang } from '../../i18n'

/** `ಕನ್ನಡ / EN`: switches the whole app between Kannada and English (the app root re-renders on the change). */
export default function LangToggle() {
  return (
    <button type="button" className="lang-toggle" onClick={() => setLang(getLang() === 'en' ? 'kn' : 'en')}>
      ಕನ್ನಡ / EN
    </button>
  )
}
