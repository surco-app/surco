import { useCallback, useEffect, useState } from 'react'
import type { ProgramCopies } from '../../../shared/types'

export function useCopies(): { programs: ProgramCopies[]; refresh: () => void } {
  const [programs, setPrograms] = useState<ProgramCopies[]>([])

  const refresh = useCallback(() => {
    void window.api.copiesStatus().then(setPrograms)
  }, [])

  useEffect(() => {
    refresh()
    const offs = [
      window.api.onCopiesChanged(refresh),
      window.api.onRekordboxQueueChanged(refresh),
      window.api.onEngineCueQueueChanged(refresh),
      window.api.onTraktorCueQueueChanged(refresh),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [refresh])

  return { programs, refresh }
}
