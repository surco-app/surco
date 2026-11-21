import { yearFromDate } from '../../../shared/tagFields'
import type { TrackItem } from '../types'
import { withSignatureMeta } from './dirty'
import { diskMeta } from './listReviewEntries'

// A read applies the full release date setting of the moment, so a row read before the user
// changed it kept the other year and saved that over the file. The rows still showing the
// file's date under the old setting take it under the new one, disk snapshot included so
// nothing reads as staged; a year the user typed stays theirs.
export function followReleaseDate(tracks: TrackItem[], fullReleaseDate: boolean): TrackItem[] {
  return tracks.map((t) => {
    if (!t.fileDate || t.diskSignature === undefined) return t
    const from = fullReleaseDate ? yearFromDate(t.fileDate) : t.fileDate
    const to = fullReleaseDate ? t.fileDate : yearFromDate(t.fileDate)
    if (diskMeta(t)?.year !== from) return t
    const diskSignature = withSignatureMeta(t.diskSignature, (m) => ({ ...m, year: to }))
    const moved = (signature: string) => (signature === t.diskSignature ? diskSignature : signature)
    return {
      ...t,
      meta: t.meta.year === from ? { ...t.meta, year: to } : t.meta,
      diskSignature,
      processedSignature: t.processedSignature && moved(t.processedSignature),
      fillSignature: t.fillSignature && moved(t.fillSignature),
      reviewRaw: t.reviewRaw && { ...t.reviewRaw, signature: moved(t.reviewRaw.signature) },
      notInFile: t.notInFile && { ...t.notInFile, signature: moved(t.notInFile.signature) },
    }
  })
}
