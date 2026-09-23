import type { TrackProperties } from '../../../shared/types'
import { formatKHz } from './quality'

// The source container, read off the input PATH's last extension and uppercased (FLAC,
// MP3, WAV…). The path is the only reliable place: the parsed file name has already
// dropped its extension and carries a track-number dot ("20. Title"), so splitting THAT
// on '.' returned the title as the "extension". The regex anchors to the final segment
// and rejects dots inside it, so a dotted title can't masquerade as a format. Empty when
// the path has no extension. Mirrors triage.sourceFormat's rule so the two never disagree.
export function fileExtension(inputPath: string): string {
  return /\.([^./\\]+)$/.exec(inputPath)?.[1]?.toUpperCase() ?? ''
}

// Human-readable file size from a byte count, in the Finder-style steps (whole KB
// up to a megabyte, then one-decimal MB / two-decimal GB) shown in the Properties
// panel. Returns an empty string for an unreadable size so a failed stat leaves the
// row blank instead of printing "NaN B".
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

// A glanceable digest of the rip's shape (format · kHz · bits · channel mode); each
// part drops out when the probe could not read it, so a lossy file just shows fewer
// fields rather than blanks. The format is the path's extension, the name the verdict
// uses, not ffprobe's container family (which calls an ALAC .m4a "MOV").
export function audioSummaryParts(
  p: TrackProperties,
  inputPath: string,
  tr: (key: string, params?: Record<string, unknown>) => string,
): string[] {
  return [
    fileExtension(inputPath),
    p.sampleRateHz ? formatKHz(p.sampleRateHz) : '',
    p.bitDepth !== null ? tr('editor.propBitDepthValue', { bits: p.bitDepth }) : '',
    p.channels
      ? tr(`editor.channelMode${p.channels <= 1 ? 'Mono' : p.channels === 2 ? 'Stereo' : 'Multi'}`)
      : '',
  ].filter(Boolean)
}
