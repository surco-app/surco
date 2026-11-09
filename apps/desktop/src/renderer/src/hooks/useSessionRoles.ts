import { useEffect, useMemo, useRef } from 'react'
import type { DjProgram } from '../../../shared/djProgram'
import { rolesForProgram, withPlaylistRole } from '../../../shared/sessionSettings'
import type { PlaylistRole } from '../../../shared/sessionTypes'
import { useStableCallback } from './useStableCallback'

type Roles = Readonly<Record<string, PlaylistRole>>

export interface SessionRoles {
  forProgram: Record<string, PlaylistRole>
  setRole: (id: string, role: PlaylistRole | null) => void
}

export function useSessionRoles(
  saved: Roles,
  program: DjProgram | null,
  save: (roles: Record<string, PlaylistRole>) => void,
): SessionRoles {
  const latest = useRef<Roles>(saved)

  useEffect(() => {
    latest.current = saved
  }, [saved])

  const setRole = useStableCallback((id: string, role: PlaylistRole | null) => {
    if (!program) return
    const next = withPlaylistRole(latest.current, program, id, role)
    latest.current = next
    save(next)
  })

  const forProgram = useMemo(
    () => (program ? rolesForProgram(saved, program) : {}),
    [saved, program],
  )

  return { forProgram, setRole }
}
