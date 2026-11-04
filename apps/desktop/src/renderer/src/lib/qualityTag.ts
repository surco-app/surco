import type { QueryClient } from '@tanstack/react-query'
import { normalizeImportFields } from '../../../shared/defaults'
import type { TrackMetadata } from '../../../shared/types'
import { cachedSpectrumOf } from '../hooks/useSpectrogram'
import type { TrackItem } from '../types'
import { type TrackQuality, trackQuality } from './triage'

// The list's own words, in English whatever the app language: the value travels with the
// file into other programs, where a crate rule written on one machine has to match the
// tag another machine wrote.
const QUALITY_TAG_WORDS: Record<Exclude<TrackQuality, 'unanalyzed'>, string> = {
  good: 'Good',
  warn: 'Doubtful',
  bad: 'Low quality',
  processed: 'Reprocessed',
  transcoded: 'Lossy',
  damaged: 'Damaged',
}

export function withQualityTag(
  meta: TrackMetadata,
  track: Pick<TrackItem, 'inputPath' | 'spectrum'>,
  auto: boolean,
): TrackMetadata {
  if (!auto) return meta
  const verdict = trackQuality(track)
  return verdict === 'unanalyzed' ? meta : { ...meta, quality: QUALITY_TAG_WORDS[verdict] }
}

// The same, for a caller holding the settings and the query cache rather than the verdict:
// the conversion job and the file-name builders, so a {quality} name and the tag agree.
export function withCachedQualityTag(
  meta: TrackMetadata,
  track: Pick<TrackItem, 'inputPath'>,
  client: QueryClient,
  importFields: string[] | undefined,
): TrackMetadata {
  return withQualityTag(
    meta,
    { inputPath: track.inputPath, spectrum: cachedSpectrumOf(client, track.inputPath) },
    normalizeImportFields(importFields).includes('quality'),
  )
}
