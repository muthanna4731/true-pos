import { useSession } from '../shell/session'
import { t } from '../../i18n'
import CloseShift from './CloseShift'
import PageHeader from './PageHeader'

/** The manager's [Close shift]: pick a shift still open at the shop and count its drawer. Closing your own shift ends your session. */
export default function CloseShiftPage() {
  const { shiftId, logout } = useSession()
  return (
    <>
      <PageHeader title={t('mgr.closeShift')} />
      <CloseShift
        onDone={(closedId) => {
          if (closedId === shiftId) logout()
        }}
      />
    </>
  )
}
