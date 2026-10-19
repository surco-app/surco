import type { TrackItem } from '../types'

export interface RowDisplay {
  title: string
  artist: string
  duration: number | undefined
  cover: string | undefined
  waiting: boolean
}

export function rowDisplay(t: TrackItem): RowDisplay {
  const reading = t.loadingMeta ? t.sourcePreview : undefined
  const previewLength = t.sourcePreview?.durationSec
  return {
    title: reading?.title || t.listLabel,
    artist: reading ? reading.artist : t.meta.artist,
    duration: t.duration ?? (previewLength && previewLength > 0 ? previewLength : undefined),
    cover: t.embeddedCover ?? t.sourcePreview?.coverUrl,
    waiting: Boolean(t.loadingMeta) && !t.sourcePreview,
  }
}
