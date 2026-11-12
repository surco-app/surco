import { useEffect, useRef } from 'react'
import type { WindowSnapshot } from '../../../shared/diagnostics'

type Counts = Omit<WindowSnapshot, 'heapUsedMb' | 'heapLimitMb'>

export function useWindowSnapshot(read: () => Counts, everyMs = 30_000): void {
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    const send = () => window.api.reportSnapshot(readRef.current())
    send()
    const timer = setInterval(send, everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
}
