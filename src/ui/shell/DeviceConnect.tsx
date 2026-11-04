import { useEffect, useState, type FormEvent } from 'react'
import { t } from '../../i18n'
import { AuthError, connectDevice, currentDevice, syncConfig, type Device } from '../../sync/client'
import { startSync } from '../../sync/start'

/**
 * The login screen's device line. A device is connected once, with the login made for it, and then syncs by itself.
 * Hidden in the demo build, which has no cloud.
 */
export default function DeviceConnect() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void currentDevice().then((d) => alive && setDevice(d))
    return () => {
      alive = false
    }
  }, [])

  if (!syncConfig() || device === undefined) return null
  if (device) return <p className="device-line">{t('device.connected', { label: device.label })}</p>

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const d = await connectDevice(email, password)
      setDevice(d)
      setPassword('')
      await startSync()
    } catch (err) {
      setError(err instanceof AuthError ? t('device.badLogin') : t('device.noInternet'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <p className="device-line">
        {t('device.notConnected')}{' '}
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          {t('device.connect')}
        </button>
      </p>
    )
  }
  return (
    <form className="device-connect" onSubmit={submit} aria-label={t('device.connect')}>
      <label>
        {t('device.email')}
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t('device.password')}
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {t('device.connect')}
      </button>
    </form>
  )
}
