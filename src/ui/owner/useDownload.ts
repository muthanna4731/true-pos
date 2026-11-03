import { useRef, useState } from 'react'
import { errorText, guarded } from '../office/shared'

/** Runs a download once at a time. A failed one leaves an error to show; the next good one clears it. */
export function useDownload(): { run(work: () => Promise<void>): Promise<void>; error: string | null } {
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<void>): Promise<void> => {
    const code = await guarded(busy, work)
    if (code !== 'busy') setError(code === null ? null : errorText(code))
  }
  return { run, error }
}
