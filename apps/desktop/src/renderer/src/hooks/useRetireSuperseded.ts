import { useEffect, useRef } from 'react'
import { retireDecision } from '../lib/autoRetiredFile'
import { baseName } from '../lib/baseName'
import { sourceTrashedPatch } from '../lib/export'
import { isMacOS, isWindows } from '../lib/platform'
import type { TrackItem } from '../types'

const sameFileKey = (path: string) => {
  const composed = path.normalize('NFC')
  return isMacOS() || isWindows() ? composed.toLowerCase() : composed
}

interface Params {
  tracks: TrackItem[]
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  removeTracks: (ids: string[], everywhere?: boolean) => void
  reportTrashFailure: (fileName: string) => void
}

export function useRetireSuperseded({
  tracks,
  updateTrack,
  removeTracks,
  reportTrashFailure,
}: Params): void {
  const started = useRef(new Set<string>())
  // Logged once per row and reason: a check run again can still clear the original.
  const told = useRef(new Set<string>())
  useEffect(() => {
    for (const track of tracks) {
      const decision = retireDecision(track)
      if (!decision) continue
      const path = 'retire' in decision ? decision.retire : decision.keep
      const key = `${track.id}\0${path}`
      const kept = (reason: string): void => {
        if (told.current.has(`${key}\0${reason}`)) return
        told.current.add(`${key}\0${reason}`)
        window.api.logInfo(`retire: kept ${path}: ${reason}`)
      }
      if ('keep' in decision) {
        kept(decision.reason)
        continue
      }
      if (started.current.has(key)) continue
      started.current.add(key)
      const old = sameFileKey(path)
      const onOldFile = tracks.filter(
        (t) =>
          t.id !== track.id &&
          [t.inputPath, t.outputPath].some((p) => !!p && sameFileKey(p) === old),
      )
      if (onOldFile.some((t) => t.status === 'processing')) {
        kept('another row of the list is converting it')
        updateTrack(track.id, { supersededKept: true })
        continue
      }
      const patch: Partial<TrackItem> =
        path === track.inputPath
          ? { supersededTrashed: true, ...sourceTrashedPatch(track) }
          : { supersededTrashed: true }
      const name = baseName(path).replace(/\.[^.]+$/, '')
      const label = track.replacesLabel ?? ''
      const musicNames = label.split(' - ').map((_, i, parts) => parts.slice(i).join(' - '))
      const titles = [...new Set([track.meta.title, name, ...musicNames])].filter(
        (t): t is string => !!t,
      )
      window.api
        .retireSuperseded(path, titles)
        .then((done) => {
          if (done !== 'retired') kept('a DJ library or Apple Music uses it, or could not be asked')
          updateTrack(track.id, done === 'retired' ? patch : { supersededKept: true })
          if (done === 'retired' && onOldFile.length > 0)
            removeTracks(
              onOldFile.map((t) => t.id),
              true,
            )
        })
        .catch(() => {
          updateTrack(track.id, { supersededKept: true })
          reportTrashFailure(baseName(path))
        })
    }
  }, [tracks, updateTrack, removeTracks, reportTrashFailure])
}
