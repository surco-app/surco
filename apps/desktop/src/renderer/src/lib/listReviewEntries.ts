import type { LibraryTagUpdate, ReviewEntry, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import type { ReviewLoad } from './reviewSource'

const FIELDS = ['title', 'artist', 'albumArtist', 'album', 'genre'] as const

// diskSignature holds the pure read of the file; meta also carries what the user typed and
// has not saved. The review writes over the file, so it reads the file's side.
export function diskMeta(row: TrackItem): TrackMetadata | null {
  if (!row.diskSignature) return null
  try {
    const [meta] = JSON.parse(row.diskSignature) as [TrackMetadata]
    return meta && typeof meta === 'object' ? meta : null
  } catch {
    return null
  }
}

export function listReviewEntries(rows: TrackItem[]): ReviewLoad {
  const entries: ReviewEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const row of rows) {
    if (seen.has(row.inputPath)) continue
    seen.add(row.inputPath)
    const meta =
      row.loadingMeta || row.metaReadFailed || row.status === 'processing' ? null : diskMeta(row)
    if (!meta) {
      skipped += 1
      continue
    }
    // Every read trims; the untrimmed spelling is what the review is looking for.
    const raw = row.reviewRaw?.signature === row.diskSignature ? row.reviewRaw?.fields : undefined
    const entry: ReviewEntry = {
      id: row.inputPath,
      title: raw?.title ?? meta.title ?? '',
      artist: raw?.artist ?? meta.artist ?? '',
      albumArtist: raw?.albumArtist ?? meta.albumArtist ?? '',
      album: raw?.album ?? meta.album ?? '',
      genre: raw?.genre ?? meta.genre ?? '',
    }
    if (row.duration !== undefined && row.duration > 0) entry.durationSec = Math.round(row.duration)
    entries.push(entry)
  }
  return { entries, skipped }
}

export function withListChanges(
  entries: ReviewEntry[],
  updates: LibraryTagUpdate[],
  gone: ReadonlySet<string>,
): ReviewEntry[] {
  const byPath = new Map<string, LibraryTagUpdate[]>()
  for (const u of updates) byPath.set(u.path, [...(byPath.get(u.path) ?? []), u])
  return entries
    .filter((e) => !gone.has(e.id))
    .map((e) => {
      let next = e
      for (const u of byPath.get(e.id) ?? [])
        for (const field of FIELDS) {
          const change = u.fields[field]
          if (change && next[field].normalize('NFC') === change.from.normalize('NFC'))
            next = { ...next, [field]: change.to }
        }
      return next
    })
}
