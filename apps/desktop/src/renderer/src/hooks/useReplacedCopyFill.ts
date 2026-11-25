import { useEffect } from 'react'
import type { AppleMusicTrackMeta, TrackMetadata } from '../../../shared/types'
import { fillFromAppleMusic } from '../lib/appleMusicFill'
import { copyCoverWins, fillFromCopy, groupingFromCopy, showsOwnCover } from '../lib/fillFromCopy'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  copyPath: string
  // The copy is another version of the track: it lends only its grouping and its cover.
  anotherVersion?: boolean
  // The copy's Apple Music entry, when the copy is in Music: Music keeps the grouping and the
  // artwork of a WAV in its database only, since it never writes tags into one.
  musicEntry?: string
  onChange: (patch: Partial<TrackItem>) => void
  onRecordUndo?: (ids: string[], opts: { cover: boolean }) => void
}

export function useReplacedCopyFill({
  item,
  copyPath,
  anotherVersion = false,
  musicEntry = '',
  onChange,
  onRecordUndo,
}: Params): void {
  // The copy's file and Music's entry for it are read together and applied as one change, so
  // they never race on the same empty grouping nor leave two undo steps for one opening. The
  // file goes first, as for Music's own file: it is what every other program reads. Music
  // fills what it leaves, and its artwork, a re-encode kept in its database, stands in only
  // when neither the copy's file nor the track shows a picture.
  const apply = useStableCallback(
    (
      copy: TrackMetadata | null,
      cover: string | null,
      ownCover: string | null,
      music: AppleMusicTrackMeta | null,
    ) => {
      const fromFile = !copy
        ? null
        : anotherVersion
          ? groupingFromCopy(item.meta, copy)
          : fillFromCopy(item.meta, copy)
      const fromMusic = music ? musicFill(fromFile ?? item.meta, music, anotherVersion) : null
      const meta = fromMusic ?? fromFile
      const coverUrl = cover && copyCoverWins(item, cover, ownCover) ? cover : null
      const musicCoverUrl =
        !cover && !item.coverUrl && !item.coverRemoved && music?.coverUrl ? music.coverUrl : null
      if (!meta && !coverUrl && !musicCoverUrl) {
        onChange({ copyFilled: true })
        return
      }
      onRecordUndo?.([item.id], { cover: !!(coverUrl || musicCoverUrl) })
      onChange({
        ...(meta ? { meta } : {}),
        ...(coverUrl ? { coverUrl, coverPath: undefined } : {}),
        ...(musicCoverUrl ? { coverUrl: musicCoverUrl, coverPath: music?.coverPath } : {}),
        copyFilled: true,
      })
    },
  )
  const ready =
    !item.loadingMeta && !item.metaPartial && !item.copyFilled && !item.metaCleared && !!copyPath
  const needsCover = !item.coverRemoved && !item.coverPicked
  const ownCoverPath = needsCover && showsOwnCover(item) ? item.inputPath : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track, the copy and readiness; apply reads the live row when the tags arrive.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const cover = needsCover
      ? window.api.readCoverFull(copyPath).catch(() => null)
      : Promise.resolve(null)
    const ownCover = ownCoverPath
      ? window.api.readCoverFull(ownCoverPath).catch(() => null)
      : Promise.resolve(null)
    const music = musicEntry
      ? window.api.appleMusicEntryMeta(copyPath, [musicEntry]).catch(() => null)
      : Promise.resolve(null)
    // A copy that cannot be read is left for another opening, unless Music answered for it:
    // what its database holds is worth having without the file's tags.
    const tags = window.api.readTags(copyPath).catch(() => null)
    Promise.all([tags, cover, ownCover, music]).then(([copy, art, own, entry]) => {
      if (!cancelled && (copy || entry)) apply(copy, art, own, entry)
    })
    return () => {
      cancelled = true
    }
  }, [item.id, copyPath, musicEntry, ready])
}

// Another version lends Music's grouping alone, like its file's: its year or comment belong
// to that other edit.
function musicFill(
  meta: TrackMetadata,
  music: AppleMusicTrackMeta,
  anotherVersion: boolean,
): TrackMetadata | null {
  const filled = anotherVersion ? groupingFromCopy(meta, music) : fillFromAppleMusic(meta, music)
  return filled && filled !== meta ? filled : null
}
