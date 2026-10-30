import { reportAsOf } from '../../domain/reports'

/** The stamp beside a figure: "as of 2:31 PM", or the note that a closed day shows its locked numbers. */
export default function AsOf({ dayClose, now }: { dayClose: { lockedAt: string } | undefined; now: string }) {
  const { locked, label } = reportAsOf(dayClose, now)
  return <span className={locked ? 'as-of locked' : 'as-of'}>{label}</span>
}
