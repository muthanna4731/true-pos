import { useSearchParams } from 'react-router-dom'
import { clock, dayOrToday, istDate } from '../../domain/time'
import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import CloseShift from './CloseShift'
import PageHeader from './PageHeader'

/**
 * The manager's [Close shift]: pick a shift still open at the shop and count its drawer. The last close of the day locks it.
 * `?day=YYYY-MM-DD` (from the "did not close yesterday" to-do) points [Lock day] at that earlier day instead of today.
 */
export default function CloseShiftPage({ store }: { store: Store }) {
  const [params] = useSearchParams()
  const day = dayOrToday(params.get('day'), istDate(clock.now()))
  return (
    <>
      <PageHeader title={t('mgr.closeShift')} />
      <CloseShift storeCode={store.code} day={day} onDone={() => {}} />
    </>
  )
}
