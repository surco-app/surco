export interface TracklistLine {
  at: string | null
  artist: string
  title: string
  suggested: boolean
  raw: string
}

export interface ParsedTracklist {
  lines: TracklistLine[]
  gaps: number
  ignored: number
}

const TIME = /^\s*[-•*]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.*)$/
const SUGGESTED = /\s*\(\?\)\s*$/
const DASHES = /\s[-–—]\s/g
const UNTIMED_TRACK = /\s[-–]\s/
const SEPARATOR = ' - '

function parseLine(text: string, at: string | null): TracklistLine {
  const suggested = SUGGESTED.test(text)
  const raw = text.replace(SUGGESTED, '').replace(DASHES, SEPARATOR).trim()
  const cut = raw.indexOf(SEPARATOR)
  if (cut < 0) return { at, artist: '', title: raw, suggested, raw }
  const artist = raw.slice(0, cut).trim()
  const parts = raw
    .slice(cut + SEPARATOR.length)
    .split(SEPARATOR)
    .map((p) => p.trim())
  const title = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(' ')})` : parts[0]
  return { at, artist, title, suggested, raw }
}

export function parseTracklist(text: string): ParsedTracklist {
  const lines: TracklistLine[] = []
  let gaps = 0
  let ignored = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const timed = line.match(TIME)
    if (timed) {
      if (timed[2].startsWith('?')) gaps++
      else lines.push(parseLine(timed[2], timed[1]))
      continue
    }
    if (UNTIMED_TRACK.test(line)) lines.push(parseLine(line.trim(), null))
    else ignored++
  }
  return { lines, gaps, ignored }
}
