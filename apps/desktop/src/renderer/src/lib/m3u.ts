import type { TrackItem } from '../types'

// Builds an extended M3U8 playlist (UTF-8, absolute paths) from the loaded tracks —
// the lingua franca for everything that isn't DJ software (players, car units, other
// library managers). Pure like the other exporters: the caller writes the string.
export function buildM3u(tracks: TrackItem[]): string {
  const lines = ['#EXTM3U']
  for (const t of tracks) {
    // Same rule as rekordbox/Traktor/Serato: the converted copy is the file the
    // playlist should point at when it exists, the original otherwise.
    const path = t.outputPath ?? t.inputPath
    const { artist, title } = t.meta
    const label = artist && title ? `${artist} - ${title}` : title || t.listLabel || t.fileName
    // -1 is the format's "unknown length"; players still play the entry.
    const duration = t.duration !== undefined ? String(Math.round(t.duration)) : '-1'
    lines.push(`#EXTINF:${duration},${label}`, path)
  }
  return `${lines.join('\n')}\n`
}
