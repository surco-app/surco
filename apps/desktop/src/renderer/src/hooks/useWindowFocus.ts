import { useEffect } from 'react'
import { useStableCallback } from './useStableCallback'

// Subscribes to the main process's window focus/blur events for the component's lifetime,
// invoking onFocus(focused) on each change and disposing the listener on unmount. The one
// place the subscribe-and-dispose pattern lives, so no caller forgets to return the
// unsubscribe and leaks a listener across remounts. The handler is stabilised so the
// subscription is made once and always runs the latest closure.
export function useWindowFocus(onFocus: (focused: boolean) => void): void {
  const stable = useStableCallback(onFocus)
  useEffect(() => window.api.onWindowFocus(stable), [stable])
}
