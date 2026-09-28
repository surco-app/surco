import { useEffect, useState } from 'react'

export function useExitPresence(
  present: boolean,
  ms: number,
): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(present)
  if (present && !mounted) setMounted(true)

  useEffect(() => {
    if (present) return
    const timer = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(timer)
  }, [present, ms])

  return { mounted: present || mounted, leaving: !present && mounted }
}
