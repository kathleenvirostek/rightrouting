import { useCallback, useEffect, useRef, useState } from 'react'

// Fetches on mount and every `intervalMs` while the tab is visible.
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    if (!intervalMs) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, intervalMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, intervalMs, ...deps])

  return { data, error, refresh, loading: data === null && error === null }
}
