import { t } from '../../i18n'

export type SyncTone = 'ok' | 'offline' | 'problem'

/** What the sync badge says. Offline wins over a problem: a failed send while offline is expected. */
export function syncState(online: boolean, pending: number, error?: string): { tone: SyncTone; text: string } {
  if (!online) {
    const text =
      pending === 0
        ? t('offline')
        : `${t('offline')} · ${t(pending === 1 ? 'syncBillOne' : 'syncBillMany', { n: pending })}`
    return { tone: 'offline', text: `● ${text}` }
  }
  if (error) return { tone: 'problem', text: `● ${t('syncProblemTell')}` }
  return { tone: 'ok', text: `● ${t('online')}` }
}
