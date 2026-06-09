import { useRef } from 'react'

// Keeps a ref pointed at the latest render's value, so a long-lived subscription (a
// once-bound event listener, a timer) can read current state without re-subscribing.
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
