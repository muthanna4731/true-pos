import { t } from '../../i18n'
import { registerLogoTap } from './demoPanelState'

/** The product name. Three quick taps on it open the demo panel. */
export default function Logo() {
  return (
    <span className="logo" onClick={() => registerLogoTap()}>
      {t('appName')}
    </span>
  )
}
