import { useEffect, useRef } from 'react'
import { autoRetiredFile } from '../lib/autoRetiredFile'
import { baseName } from '../lib/baseName'
import type { TrackItem } from '../types'

interface Params {
  tracks: TrackItem[]
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  reportTrashFailure: (fileName: string) => void
}

export function useRetireSuperseded({ tracks, updateTrack, reportTrashFailure }: Params): void {
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
      const name = baseName(path).replace(/\.[^.]+$/, '')
      const label = track.replacesLabel ?? ''
      const musicNames = label.split(' - ').map((_, i, parts) => parts.slice(i).join(' - '))
      const titles = [...new Set([track.meta.title, name, ...musicNames])].filter(
        (t): t is string => !!t,
      )
      window.api
        .retireSuperseded(path, titles)
        .then((done) =>
          updateTrack(track.id, done === 'retired' ? patch : { supersededKept: true }),
        )
        .catch(() => {
          updateTrack(track.id, { supersededKept: true })
          reportTrashFailure(baseName(path))
        })
    }
  }, [tracks, updateTrack, reportTrashFailure])
}
