import type { Store } from '../../domain/types'
import { t } from '../../i18n'
import CloseShift from './CloseShift'
import PageHeader from './PageHeader'

/** The manager's [Close shift]: pick a shift still open at the shop and count its drawer. The last close of the day locks it. */
export default function CloseShiftPage({ store }: { store: Store }) {
  return (
    <>
      <PageHeader title={t('mgr.closeShift')} />
      <CloseShift storeCode={store.code} onDone={() => {}} />
    </>
  )
}
