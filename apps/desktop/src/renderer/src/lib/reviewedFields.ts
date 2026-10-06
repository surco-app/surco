import type { LibraryTagUpdate, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'

type Fields = LibraryTagUpdate['fields']

function patchMeta(meta: TrackMetadata, fields: Fields): TrackMetadata {
  let next = meta
  for (const [field, change] of Object.entries(fields) as [keyof Fields, Fields[keyof Fields]][])
    if (change && meta[field].normalize('NFC') === change.from.normalize('NFC'))
      next = { ...next, [field]: change.to }
  return next
}

// The review wrote these fields on the file itself, so the disk snapshot moves with them.
// Rereading instead does not work: a read merges under the row's live values, so the old
// spelling stayed on the row and counted as an edit to write back.
export function withReviewedFields(track: TrackItem, fields: Fields): TrackItem {
  const meta = patchMeta(track.meta, fields)
  let diskSignature = track.diskSignature
  if (diskSignature !== undefined) {
    const [diskMeta, ...rest] = JSON.parse(diskSignature) as [TrackMetadata, ...unknown[]]
    const patched = patchMeta(diskMeta, fields)
    if (patched !== diskMeta) diskSignature = JSON.stringify([patched, ...rest])
  }
  if (meta === track.meta && diskSignature === track.diskSignature) return track
  return {
    ...track,
    meta,
    diskSignature,
    ...(track.processedSignature !== undefined &&
      track.processedSignature === track.diskSignature && { processedSignature: diskSignature }),
  }
}
