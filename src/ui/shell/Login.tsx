import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../../db/db'
import type { Role, User } from '../../domain/types'
import { t } from '../../i18n'
import { homeFor } from './homes'
import LangToggle from './LangToggle'
import Logo from './Logo'
import PinPad from './PinPad'
import { useSession } from './session'

const ROLE_ORDER: Role[] = ['cashier', 'manager', 'office', 'owner']

/** Who is working: a tile per person, then the PIN pad. `?store=TSTS2` shows only that shop's people. */
export default function Login() {
  const { user: signedIn, login } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const storeCode = params.get('store')
  const [picked, setPicked] = useState<User | null>(null)

  const users = useLiveQuery(() => db.users.toArray(), [])
  const stores = useLiveQuery(() => db.stores.toArray(), [])

  if (signedIn) return <Navigate to={homeFor(signedIn.role)} replace />

  const shown = (users ?? [])
    .filter((u) => !storeCode || u.storeCodes.includes(storeCode))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.id < b.id ? -1 : 1))
  const storeName = (u: User): string =>
    u.storeCodes.length === 1 ? (stores?.find((s) => s.code === u.storeCodes[0])?.name ?? '') : ''

  const submit = async (pin: string): Promise<boolean> => {
    if (!picked) return false
    const ok = await login(picked.id, pin) // a thrown error is shown by the PIN pad as a failure, not as a wrong PIN
    if (ok) navigate(homeFor(picked.role), { replace: true })
    return ok
  }

  return (
    <main className="login">
      <header className="shell-header">
        <Logo />
        <span className="spacer" />
        <LangToggle />
      </header>

      {picked ? (
        <section className="login-pin">
          <h1>{picked.name}</h1>
          <p>{t('login.enterPin')}</p>
          <PinPad onSubmit={submit} />
          <button type="button" className="link-button" onClick={() => setPicked(null)}>
            {t('login.back')}
          </button>
        </section>
      ) : (
        <section>
          <h1>{t('login.pickUser')}</h1>
          {users && shown.length === 0 && <p>{t('login.empty')}</p>}
          <div className="user-grid">
            {shown.map((u) => (
              <button key={u.id} type="button" className={`user-tile role-${u.role}`} onClick={() => setPicked(u)}>
                <span className="user-name">{u.name}</span> <span className="user-role">{t(`role.${u.role}`)}</span>{' '}
                <span className="user-store">{storeName(u)}</span>
              </button>
            ))}
          </div>
          <p className="demo-pins">
            <strong>{t('login.demo')}</strong> {t('role.cashier')} 1111 · {t('role.manager')} 2222 · {t('role.office')} 3333 ·{' '}
            {t('role.owner')} 4444
          </p>
        </section>
      )}
    </main>
  )
}
