import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db } from '../../db/db'
import { createOffer, endOffer } from '../../db/offers'
import { rupeesToPaise, formatINR } from '../../domain/money'
import { clock, formatDate, istDate, istDayStart } from '../../domain/time'
import type { Offer } from '../../domain/types'
import { t } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { errorText, guarded } from '../office/shared'
import { useSession } from '../shell/session'

const SHOWN = 30
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** What an offer gives, in words. */
function describe(o: Offer): string {
  return o.discountType === 'amount' ? t('owner.offOff', { amount: formatINR(o.amountPerUnit ?? 0) }) : t('owner.offFree', { buy: o.buyQty ?? 0, free: o.freeQty ?? 0 })
}

/** The owner's offers: what is running, a form for a new one, and [End] for each one still running. */
export default function Offers() {
  useLang()
  const { user } = useSession()
  const busy = useRef(false)
  const today = istDate(clock.now())
  const [type, setType] = useState<Offer['type']>('store')
  const [find, setFind] = useState('')
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState<Offer['discountType']>('amount')
  const [rupees, setRupees] = useState('')
  const [buy, setBuy] = useState('')
  const [free, setFree] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 30))
  const [error, setError] = useState<string | null>(null)

  const offers = useLiveQuery(() => db.offers.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const brands = useMemo(() => [...new Set((products ?? []).map((p) => p.brand).filter(Boolean))].sort(), [products])
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase()
    return (products ?? []).filter((p) => p.materialType === 'ALC' && (q === '' || `${p.shortName} ${p.description}`.toLowerCase().includes(q))).slice(0, SHOWN)
  }, [products, find])

  if (!offers || !products) return null

  const create = async () => {
    const n = Number(rupees)
    setError(
      await guarded(busy, async () => {
        await createOffer(
          {
            type,
            ...(type === 'store' ? { productId: target } : { brand: target }),
            discountType: kind,
            ...(kind === 'amount' ? { amountPerUnit: rupeesToPaise(n) } : { buyQty: Number(buy), freeQty: Number(free) }),
            from,
            to,
          },
          user?.id ?? '',
        )
        setTarget('')
        setRupees('')
        setBuy('')
        setFree('')
      }),
    )
  }
  const end = async (code: string) => setError(await guarded(busy, () => endOffer(code)))
  const targetName = (o: Offer): string => (o.type === 'store' ? (byId.get(o.productId ?? '')?.shortName ?? o.productId ?? '') : (o.brand ?? ''))
  const message = error ? (error.startsWith('offer_') ? t('owner.offerInvalid') : errorText(error)) : ''

  return (
    <section className="owner-offers">
      <h2>{t('owner.offers')}</h2>
      {offers.length === 0 && <p>{t('owner.noOffers')}</p>}
      <ul className="offer-list">
        {offers.map((o) => {
          const running = o.from <= today && today <= o.to
          return (
            <li key={o.code}>
              <strong>{targetName(o)}</strong> · {describe(o)} · {formatDate(istDayStart(o.from))} – {formatDate(istDayStart(o.to))} ·{' '}
              {running ? t('owner.running') : o.to < today ? t('owner.ended') : t('owner.notStarted')}
              {o.to >= today && (
                <button type="button" onClick={() => end(o.code)}>
                  {t('owner.end')} {o.code}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <h3>{t('owner.newOffer')}</h3>
      <div className="offer-form">
        <label>
          {t('owner.offerType')}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as Offer['type'])
              setTarget('')
            }}
          >
            <option value="store">{t('owner.byProduct')}</option>
            <option value="brand">{t('owner.byBrand')}</option>
          </select>
        </label>
        {type === 'store' ? (
          <>
            <label>
              {t('owner.findProduct')}
              <input value={find} onChange={(e) => setFind(e.target.value)} />
            </label>
            <label>
              {t('owner.product')}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">–</option>
                {matches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.shortName || p.description}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            {t('owner.brand')}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">–</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('owner.discountType')}
          <select value={kind} onChange={(e) => setKind(e.target.value as Offer['discountType'])}>
            <option value="amount">{t('owner.rupeesOff')}</option>
            <option value="free_qty">{t('owner.freeQty')}</option>
          </select>
        </label>
        {kind === 'amount' ? (
          <label>
            {t('owner.rupeesPerBottle')}
            <input inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} />
          </label>
        ) : (
          <>
            <label>
              {t('owner.buyQty')}
              <input inputMode="numeric" value={buy} onChange={(e) => setBuy(e.target.value)} />
            </label>
            <label>
              {t('owner.freeBottles')}
              <input inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value)} />
            </label>
          </>
        )}
        <label>
          {t('owner.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('owner.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" disabled={!target} onClick={create}>
          {t('owner.createOffer')}
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </section>
  )
}
