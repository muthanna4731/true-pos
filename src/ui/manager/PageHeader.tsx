import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'
import { ShopInHeader, ShopPicker } from '../office/ShopScope'
import { homeFor } from '../shell/homes'
import { useSession } from '../shell/session'

/** A screen's title, with a way back: to the signed-in role's home unless `backTo` says otherwise. Under a ShopScope it also carries the compact shop picker. */
export default function PageHeader({ title, backTo }: { title: string; backTo?: string }) {
  const navigate = useNavigate()
  const { user } = useSession()
  const withShop = useContext(ShopInHeader)
  return (
    <div className="page-header">
      <button type="button" className="link-button" onClick={() => navigate(backTo ?? (user ? homeFor(user.role) : '/login'))}>
        ← {t('back')}
      </button>
      <h1>{title}</h1>
      {withShop && <ShopPicker className="shop-pick header-pick" />}
    </div>
  )
}
