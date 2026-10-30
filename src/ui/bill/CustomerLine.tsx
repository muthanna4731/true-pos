import { useEffect, useRef, useState, type FormEvent } from 'react'
import { newId } from '../../domain/id'
import type { Reward } from '../../domain/types'
import { t } from '../../i18n'
import { getLoyaltyClient, LoyaltyError } from '../../loyalty/client'

interface Props {
  /** The member on this bill, if any. */
  memberCode: string | undefined
  /** Look the typed code up and put the member on the bill. */
  onAttach(raw: string): Promise<void>
  onRemove(): void
  /** Show a short message in the bill screen's notice bar. */
  notify(message: string): void
}

type Info = { maskedName: string; points: number }

const pointsText = (n: number): string => (n === 1 ? t('loyalty.onePoint') : t('loyalty.points', { n: String(n) }))

/**
 * The customer on the bill: a box for a member code, or `R••• ··4821 · 240 points` with [Use points] once one is added.
 * Only mounted while loyalty is on.
 */
export default function CustomerLine({ memberCode, onAttach, onRemove, notify }: Props) {
  const [typed, setTyped] = useState('')
  // undefined: not loaded yet; null: the server could not be reached.
  const [info, setInfo] = useState<Info | null | undefined>(undefined)
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    setInfo(undefined)
    setChoosing(false)
    const client = getLoyaltyClient()
    if (!memberCode || !client) return
    let alive = true
    client.memberInfo(memberCode).then(
      (found) => alive && setInfo(found),
      () => alive && setInfo(null),
    )
    return () => {
      alive = false
    }
  }, [memberCode])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const raw = typed
    setTyped('')
    void onAttach(raw)
  }

  if (!memberCode) {
    return (
      <form className="customer-line" onSubmit={submit}>
        <input
          type="text"
          className="customer-input"
          aria-label={t('loyalty.memberCode')}
          placeholder={t('loyalty.memberCode')}
          autoComplete="off"
          autoCapitalize="characters"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" disabled={typed.trim() === ''}>
          {t('loyalty.add')}
        </button>
      </form>
    )
  }

  return (
    <div className="customer-line">
      {info === undefined ? null : info === null ? (
        <p className="customer-name">{t('loyalty.linked')}</p>
      ) : (
        <p className="customer-name">{`${info.maskedName} · ${pointsText(info.points)}`}</p>
      )}
      <div className="customer-actions">
        {info && (
          <button type="button" onClick={() => setChoosing(true)}>
            {t('loyalty.use')}
          </button>
        )}
        <button type="button" aria-label={t('loyalty.remove')} onClick={onRemove}>
          ✕
        </button>
      </div>
      {choosing && info && (
        <RewardsDialog
          memberCode={memberCode}
          points={info.points}
          onClose={() => setChoosing(false)}
          onRedeemed={(balance, reward) => {
            setInfo({ ...info, points: balance })
            setChoosing(false)
            notify(t('loyalty.redeemed', { name: reward.name, cost: String(reward.cost) }))
          }}
          notify={notify}
        />
      )}
    </div>
  )
}

interface RewardsProps {
  memberCode: string
  points: number
  onClose(): void
  onRedeemed(balance: number, reward: Reward): void
  notify(message: string): void
}

/** The active rewards. Tapping one takes the points off at once; a retry after a lost connection reuses its request id so it can't take them twice. */
function RewardsDialog({ memberCode, points, onClose, onRedeemed, notify }: RewardsProps) {
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const attempt = useRef<{ rewardId: string; requestId: string } | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    let alive = true
    const client = getLoyaltyClient()
    if (!client) return
    client.rewards().then(
      (list) => alive && setRewards(list),
      () => alive && setRewards([]),
    )
    return () => {
      alive = false
    }
  }, [])

  const redeem = async (reward: Reward): Promise<void> => {
    const client = getLoyaltyClient()
    if (!client || busy.current) return
    busy.current = true
    const current = attempt.current?.rewardId === reward.id ? attempt.current : { rewardId: reward.id, requestId: newId() }
    attempt.current = current
    try {
      const { balance } = await client.redeem(memberCode, reward.id, current.requestId, reward.cost)
      attempt.current = null
      onRedeemed(balance, reward)
    } catch (e) {
      notify(e instanceof LoyaltyError && e.code === 'insufficient_points' ? t('loyalty.notEnough') : t('loyalty.redeemFailed'))
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pay-dialog" role="dialog" aria-label={t('loyalty.use')} onClick={(e) => e.stopPropagation()}>
        {rewards !== null && rewards.length === 0 && <p>{t('loyalty.noRewards')}</p>}
        {rewards?.map((r) => (
          <button key={r.id} type="button" className="reward-button" disabled={r.cost > points} onClick={() => void redeem(r)}>
            {t('loyalty.rewardButton', { name: r.name, cost: String(r.cost) })}
          </button>
        ))}
        <button type="button" onClick={onClose}>
          {t('pay.cancel')}
        </button>
      </div>
    </div>
  )
}
