import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'

/** A manager screen's title, with a way back to the three big buttons. */
export default function PageHeader({ title }: { title: string }) {
  const navigate = useNavigate()
  return (
    <div className="page-header">
      <button type="button" className="link-button" onClick={() => navigate('/manager')}>
        ← {t('back')}
      </button>
      <h1>{title}</h1>
    </div>
  )
}
