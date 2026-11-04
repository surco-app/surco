import { extname } from 'node:path'
import type { Beat } from './anlz'
import type { ExportCue, ExportTrack } from './usbExportSource'

export interface ForeignCue {
  ms: number
  kind: number
  name: string
  endMs?: number
}

export interface ExportMarks {
  cues: ExportCue[]
  grid: Beat[]
}

const MAX_ID = 2_000_000_000
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const FILE_TYPES: Record<string, number> = {
  '.mp3': 1,
  '.m4a': 4,
  '.mp4': 4,
  '.flac': 5,
  '.wav': 11,
  '.aif': 12,
  '.aiff': 12,
}

export function marksOnRekordboxClock(
  cues: ForeignCue[],
  grid: { ms: number; beat: number }[],
  deltaMs: number,
): ExportMarks {
  const moved = cues.map((c) => ({
    inMs: Math.max(0, c.ms + deltaMs),
    outMs: c.endMs === undefined ? -1 : Math.max(0, c.endMs + deltaMs),
    kind: c.kind,
    comment: c.name,
  }))
  if (grid.length < 2) return { cues: moved, grid: [] }
  const bpm = (60000 * (grid.length - 1)) / (grid[grid.length - 1].ms - grid[0].ms)
  return {
    cues: moved,
    grid: grid.map((b) => ({ beat: b.beat, bpm, ms: b.ms + deltaMs })).filter((b) => b.ms >= 0),
  }
}

function fnv1a(text: string): number {
  let hash = FNV_OFFSET
  for (const byte of Buffer.from(text, 'utf8')) hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0
  return hash
}

export function exportTrackIds(paths: readonly string[]): Map<string, string> {
  const ids = new Map<string, string>()
  const taken = new Set<number>()
  for (const path of paths) {
    const key = path.normalize('NFC')
    if (ids.has(key)) continue
    let id = (fnv1a(key) % MAX_ID) + 1
    while (taken.has(id)) id = (id % MAX_ID) + 1
    taken.add(id)
    ids.set(key, String(id))
  }
  return ids
}

export function exportFileType(path: string): number {
  return FILE_TYPES[extname(path).toLowerCase()] ?? 0
}

export function foreignExportTrack(
  id: string,
  path: string,
  over: Partial<ExportTrack>,
): ExportTrack {
  return {
    id,
    path,
    title: '',
    artist: '',
    album: '',
    genre: '',
    label: '',
    remixer: '',
    composer: '',
    mix: '',
    key: '',
    fileType: exportFileType(path),
    lengthSec: 0,
    bpm: 0,
    bitRate: 0,
    sampleRate: 0,
    bitDepth: 0,
    rating: 0,
    year: 0,
    trackNo: 0,
    discNo: 0,
    dateAdded: '',
    playCount: 0,
    comment: '',
    analysisPath: '',
    imagePath: '',
    separator: false,
    streaming: false,
    cues: [],
    ...over,
  }
}

export interface FileFacts {
  size: number
  mtimeMs: number
}

export function fileMemo<T>(
  read: (file: string) => Promise<T>,
  factsOf: (file: string) => Promise<FileFacts | null>,
  limit: number,
): () => (file: string) => Promise<T> {
  let kept = new Map<string, { facts: FileFacts; value: T }>()
  return () => {
    const before = kept
    const now = new Map<string, { facts: FileFacts; value: T }>()
    kept = now
    return async (file) => {
      const facts = await factsOf(file)
      if (!facts) return read(file)
      const hit = now.get(file) ?? before.get(file)
      const same = hit?.facts.size === facts.size && hit.facts.mtimeMs === facts.mtimeMs
      const value = hit && same ? hit.value : await read(file)
      if (now.size < limit) now.set(file, { facts, value })
      return value
    }
  }
}
