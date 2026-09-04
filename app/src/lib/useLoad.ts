import { useEffect, useState } from 'react'

/**
 * Load something, and be honest about the three states it can be in.
 *
 * The failure state matters more here than in most apps: row-level security
 * denies by returning NO ROWS, not by returning an error, so "empty" is a
 * legitimate answer that screens must render calmly. That only works if a
 * genuine failure looks different. Collapsing them — the usual `data ?? []` —
 * would show a member an empty ledger and a disconnected admin the same
 * empty ledger, and only one of those is the truth.
 */
export interface Loaded<T> {
  data: T | null
  loading: boolean
  failed: boolean
  reload: () => void
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fn().then(
      d => { if (!cancelled) { setData(d); setLoading(false) } },
      () => { if (!cancelled) { setFailed(true); setLoading(false) } },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  return { data, loading, failed, reload: () => setAttempt(n => n + 1) }
}
