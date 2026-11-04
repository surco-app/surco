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

interface RawFrame {
  tag: string
  body: Uint8Array
  raw: Uint8Array
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

function rawFramesOf(bytes: Uint8Array): RawFrame[] | null {
  const frames: RawFrame[] = []
  let at = 0
  while (at + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0)
    const end = at + 8 + length
    if (end > bytes.length) return null
    frames.push({
      tag: String.fromCharCode(...bytes.subarray(at, at + 4)),
      body: bytes.subarray(at + 8, end),
      raw: bytes.subarray(at, end),
    })
    at = end
  }
  return at === bytes.length ? frames : null
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function frameOf(tag: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(8)
  for (let i = 0; i < 4; i++) head[i] = tag.charCodeAt(i)
  new DataView(head.buffer).setUint32(4, body.length)
  return concatBytes([head, body])
}

function textFrame(tag: string, value: string): Uint8Array {
  const body = new Uint8Array(value.length * 2)
  const view = new DataView(body.buffer)
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i))
  return frameOf(tag, body)
}

function u32Frame(tag: string, value: number): Uint8Array {
  const body = new Uint8Array(4)
  new DataView(body.buffer).setUint32(0, value)
  return frameOf(tag, body)
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
    return frameOf('otrk', concatBytes(body))
  })
  return found ? concatBytes(parts) : null
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
  return concatBytes([bytes, frameOf('otrk', concatBytes(body))])
}
