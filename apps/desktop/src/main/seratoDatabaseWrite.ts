import { concat, frame, type RawFrame, rawFramesOf, textFrame } from '../shared/serato'

export type SeratoTagField = 'tsng' | 'tart' | 'talb' | 'tgen'

export interface NewSeratoTrack {
  pfil: string
  type: string
  title: string
  artist: string
  album: string
  genre: string
  addedAt: number
}

const utf16 = new TextDecoder('utf-16be')

const FILE_TYPES: Record<string, string> = {
  '.mp3': 'mp3',
  '.wav': 'wave',
  '.aif': 'aiff',
  '.aiff': 'aiff',
  '.flac': 'flac',
  '.m4a': 'quicktime',
  '.mp4': 'quicktime',
}

export function seratoFileType(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return FILE_TYPES[path.slice(dot).toLowerCase()] ?? null
}

function u32Frame(tag: string, value: number): Uint8Array {
  const body = new Uint8Array(4)
  new DataView(body.buffer).setUint32(0, value)
  return frame(tag, body)
}

function pfilOf(inner: RawFrame[]): string | null {
  const pfil = inner.find((f) => f.tag === 'pfil')
  return pfil ? utf16.decode(pfil.body).normalize('NFC') : null
}

export function seratoDatabaseHas(bytes: Uint8Array, pfil: string): boolean {
  const frames = rawFramesOf(bytes)
  if (!frames) return false
  const wanted = pfil.normalize('NFC')
  return frames.some((f) => {
    if (f.tag !== 'otrk') return false
    const inner = rawFramesOf(f.body)
    return !!inner && pfilOf(inner) === wanted
  })
}

export function withSeratoTrackFields(
  bytes: Uint8Array,
  pfil: string,
  fields: Partial<Record<SeratoTagField, string>>,
): Uint8Array | null {
  const frames = rawFramesOf(bytes)
  if (!frames) return null
  const wanted = pfil.normalize('NFC')
  const changes = Object.entries(fields) as [SeratoTagField, string][]
  let found = false
  const parts = frames.map((f) => {
    if (f.tag !== 'otrk') return f.raw
    const inner = rawFramesOf(f.body)
    if (!inner || pfilOf(inner) !== wanted) return f.raw
    found = true
    const pending = new Map(changes)
    const body = inner.map((sub) => {
      const value = pending.get(sub.tag as SeratoTagField)
      if (value === undefined) return sub.raw
      pending.delete(sub.tag as SeratoTagField)
      return textFrame(sub.tag, value)
    })
    for (const [tag, value] of pending) body.push(textFrame(tag, value))
    return frame('otrk', concat(body))
  })
  return found ? concat(parts) : null
}

export function withSeratoTrackAdded(bytes: Uint8Array, track: NewSeratoTrack): Uint8Array | null {
  if (!rawFramesOf(bytes)) return null
  const texts: [string, string][] = [
    ['ttyp', track.type],
    ['pfil', track.pfil],
    ['tsng', track.title],
    ['tart', track.artist],
    ['talb', track.album],
    ['tgen', track.genre],
  ]
  const body = [
    ...texts
      .filter(([tag, value]) => value !== '' || tag === 'pfil')
      .map(([t, v]) => textFrame(t, v)),
    textFrame('tadd', String(track.addedAt)),
    u32Frame('uadd', track.addedAt),
  ]
  return concat([bytes, frame('otrk', concat(body))])
}
