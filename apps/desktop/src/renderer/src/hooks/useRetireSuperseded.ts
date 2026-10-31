import { useEffect, useRef } from 'react'
import type { Settings } from '../../../shared/types'
import { autoRetiredFile } from '../lib/autoRetiredFile'
import { baseName } from '../lib/baseName'
import type { TrackItem } from '../types'

interface Params {
  tracks: TrackItem[]
  settings: Settings | null
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  reportTrashFailure: (fileName: string) => void
}

export function useRetireSuperseded({
  tracks,
  settings,
  updateTrack,
  reportTrashFailure,
}: Params): void {
  const started = useRef(new Set<string>())
  useEffect(() => {
    for (const track of tracks) {
      const path = autoRetiredFile(track)
      if (!path) continue
      const key = `${track.id}\0${path}`
      if (started.current.has(key)) continue
      started.current.add(key)
      const patch: Partial<TrackItem> =
        path === track.inputPath
          ? { supersededTrashed: true, originalTrashed: true }
          : { supersededTrashed: true }
      window.api
        .keepsTrash(path)
        .then((keeps) => window.api.trashFile(path, !keeps && settings?.backupPolicy === 'never'))
        .then(() => updateTrack(track.id, patch))
        .catch(() => reportTrashFailure(baseName(path)))
    }
  }, [tracks, settings, updateTrack, reportTrashFailure])
}
