import { useCallback } from 'react'
import { useLatest } from './useLatest'

// A callback whose identity never changes but whose body always sees the latest
// render's closure. This is what lets App hand a fresh inline handler to a memoized
// child (Editor, Toolbar) every render without breaking the child's memo — the child
// keeps one identity, the call still reads current state.
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useLatest(fn)
  return useCallback((...args: A) => latest.current(...args), [latest])
}
