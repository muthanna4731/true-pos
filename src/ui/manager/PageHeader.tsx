import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'
import { homeFor } from '../shell/homes'
import { useSession } from '../shell/session'

/** A screen's title, with a way back: to the signed-in role's home unless `backTo` says otherwise. */
export default function PageHeader({ title, backTo }: { title: string; backTo?: string }) {
  const navigate = useNavigate()
  const { user } = useSession()
  return (
    <div className="page-header">
      <button type="button" className="link-button" onClick={() => navigate(backTo ?? (user ? homeFor(user.role) : '/login'))}>
        ← {t('back')}
      </button>
      <h1>{title}</h1>
    </div>
  )
}
