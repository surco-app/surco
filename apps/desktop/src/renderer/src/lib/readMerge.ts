import type { TrackMetadata } from '../../../shared/types'

// A slow metadata read (cloud/network folder) can resolve after the user has already
// typed into the freshly dropped row. The read fills the form, but any field whose live
// value differs from the import-time parse was touched by the user meanwhile — and the
// user's value wins over the file's.
export function mergeReadMeta(
  imported: TrackMetadata,
  live: TrackMetadata,
  read: TrackMetadata,
): TrackMetadata {
  const merged: TrackMetadata = { ...read }
  for (const key of Object.keys(live) as (keyof TrackMetadata)[]) {
    if (live[key] !== imported[key]) copyField(merged, live, key)
  }
  return merged
}

function copyField<K extends keyof TrackMetadata>(
  into: TrackMetadata,
  from: TrackMetadata,
  key: K,
): void {
  into[key] = from[key]
}
