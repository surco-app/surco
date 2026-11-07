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

const TIME = /^\s*[-•*]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(?:[-–—|]\s+)?(.*)$/
const SUGGESTED = /\s*\(\?\)\s*$/
const DASHES = /\s[-–—]\s/g
const GLUED_DASH = /(\S)-\s+/
const UNTIMED_TRACK = /\s[-–]\s/
const NOTES = /\s+(?:=<|<+=+|-\s+https?:\/\/).*$|\s+-?\s*https?:\/\/\S+$/
const CAPS_TAIL = /\s+[A-ZÁÉÍÓÚÑ0-9!¡?¿+:.' ]{6,}$/
const SEPARATOR = ' - '

function withoutCapsNote(title: string): string {
  return /[a-záéíóúñ]/.test(title) ? title.replace(CAPS_TAIL, '').trim() : title
}

function parseLine(text: string, at: string | null): TracklistLine {
  const suggested = SUGGESTED.test(text)
  const cleaned = text.replace(SUGGESTED, '').replace(NOTES, '').replace(DASHES, SEPARATOR)
  const spaced = (
    cleaned.includes(SEPARATOR) ? cleaned : cleaned.replace(GLUED_DASH, `$1${SEPARATOR}`)
  )
    .replace(/\s+/g, ' ')
    .trim()
  const cut = spaced.indexOf(SEPARATOR)
  if (cut < 0) {
    const title = withoutCapsNote(spaced)
    return { at, artist: '', title, suggested, raw: title }
  }
  const artist = spaced.slice(0, cut).trim()
  const parts = withoutCapsNote(spaced.slice(cut + SEPARATOR.length))
    .split(SEPARATOR)
    .map((p) => p.trim())
  const title = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(' ')})` : parts[0]
  return { at, artist, title, suggested, raw: `${artist}${SEPARATOR}${parts.join(SEPARATOR)}` }
}

function isGap(text: string): boolean {
  return text.startsWith('?') || (!UNTIMED_TRACK.test(text) && !/[A-ZÁÉÍÓÚÑ]/.test(text))
}

export function parseTracklist(text: string): ParsedTracklist {
  const lines: TracklistLine[] = []
  let gaps = 0
  let ignored = 0
  const rows = text.split('\n').filter((line) => line.trim())
  const timed = rows.some((line) => TIME.test(line))
  for (const line of rows) {
    const match = line.match(TIME)
    if (match) {
      if (isGap(match[2].trim())) gaps++
      else lines.push(parseLine(match[2], match[1]))
      continue
    }
    if (!timed && UNTIMED_TRACK.test(line)) lines.push(parseLine(line.trim(), null))
    else ignored++
  }
  return { lines, gaps, ignored }
}
