import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'

/** A screen's title, with a way back: to the manager's three big buttons unless `backTo` says otherwise. */
export default function PageHeader({ title, backTo = '/manager' }: { title: string; backTo?: string }) {
  const navigate = useNavigate()
  return (
    <div className="page-header">
      <button type="button" className="link-button" onClick={() => navigate(backTo)}>
        ← {t('back')}
      </button>
      <h1>{title}</h1>
    </div>
  )
}
