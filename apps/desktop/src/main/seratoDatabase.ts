export interface SeratoTrack {
  path: string
  title: string
  artist: string
  album: string
  genre: string
  bpm: string
  key: string
  addedAt: number | null
}

export interface SeratoCrateNode {
  id: string
  name: string
  children: SeratoCrateNode[]
}

interface Frame {
  tag: string
  body: Uint8Array
}

const utf16 = new TextDecoder('utf-16be')

function framesOf(bytes: Uint8Array): { frames: Frame[]; truncated: boolean } {
  const frames: Frame[] = []
  let at = 0
  while (at + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4))
    const length =
      ((bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7]) >>> 0
    const end = at + 8 + length
    if (end > bytes.length) break
    frames.push({ tag, body: bytes.subarray(at + 8, end) })
    at = end
  }
  return { frames, truncated: at !== bytes.length }
}

function textsOf(body: Uint8Array): Map<string, string> {
  return new Map(framesOf(body).frames.map((f) => [f.tag, utf16.decode(f.body)]))
}

function addedAtOf(text: string | undefined): number | null {
  return text && /^\d+$/.test(text) ? Number(text) : null
}

export function parseSeratoDatabase(bytes: Uint8Array): SeratoTrack[] {
  const tracks: SeratoTrack[] = []
  for (const frame of framesOf(bytes).frames) {
    if (frame.tag !== 'otrk') continue
    const texts = textsOf(frame.body)
    const path = texts.get('pfil')
    if (!path) continue
    tracks.push({
      path,
      title: texts.get('tsng') ?? '',
      artist: texts.get('tart') ?? '',
      album: texts.get('talb') ?? '',
      genre: texts.get('tgen') ?? '',
      bpm: texts.get('tbpm') ?? '',
      key: texts.get('tkey') ?? '',
      addedAt: addedAtOf(texts.get('tadd')),
    })
  }
  return tracks
}

export function seratoDatabaseTruncated(bytes: Uint8Array): boolean {
  return framesOf(bytes).truncated
}

export function parseSeratoCrate(bytes: Uint8Array): string[] {
  return framesOf(bytes)
    .frames.filter((f) => f.tag === 'otrk')
    .map((f) => textsOf(f.body).get('ptrk'))
    .filter((path): path is string => !!path)
}

function sortNodes(nodes: SeratoCrateNode[]): SeratoCrateNode[] {
  nodes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  for (const node of nodes) sortNodes(node.children)
  return nodes
}

export function crateTree(fileNames: string[]): SeratoCrateNode[] {
  const roots: SeratoCrateNode[] = []
  const byId = new Map<string, SeratoCrateNode>()
  const ids = fileNames.filter((f) => f.endsWith('.crate')).map((f) => f.slice(0, -'.crate'.length))
  for (const id of ids) {
    const parts = id.split('%%')
    let siblings = roots
    for (let depth = 1; depth <= parts.length; depth++) {
      const nodeId = parts.slice(0, depth).join('%%')
      let node = byId.get(nodeId)
      if (!node) {
        node = { id: nodeId, name: parts[depth - 1], children: [] }
        byId.set(nodeId, node)
        siblings.push(node)
      }
      siblings = node.children
    }
  }
  return sortNodes(roots)
}

export interface SeratoMove {
  from: string
  to: string
}

function utf16beOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) >> 8
    out[i * 2 + 1] = text.charCodeAt(i) & 0xff
  }
  return out
}

function encodeFrames(frames: Frame[]): Uint8Array {
  const out = new Uint8Array(frames.reduce((n, f) => n + 8 + f.body.length, 0))
  let at = 0
  for (const { tag, body } of frames) {
    for (let i = 0; i < 4; i++) out[at + i] = tag.charCodeAt(i)
    new DataView(out.buffer).setUint32(at + 4, body.length)
    out.set(body, at + 8)
    at += 8 + body.length
  }
  return out
}

const SERATO_TYPE: Record<string, string> = {
  mp3: 'mp3',
  wav: 'wave',
  aif: 'aiff',
  aiff: 'aiff',
  flac: 'flac',
  m4a: 'quicktime',
  mp4: 'quicktime',
  ogg: 'ogg',
}

function typeOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? SERATO_TYPE[path.slice(dot + 1).toLowerCase()] : undefined
}

function repointFrames(
  bytes: Uint8Array,
  pathTag: 'pfil' | 'ptrk',
  moves: SeratoMove[],
): { bytes: Uint8Array; moved: string[] } {
  const byFrom = new Map(moves.map((m) => [m.from.normalize('NFC'), m]))
  const moved: string[] = []
  const { frames } = framesOf(bytes)
  let changed = false
  const out = frames.map((outer): Frame => {
    if (outer.tag !== 'otrk') return outer
    const inner = framesOf(outer.body).frames
    const at = inner.findIndex((f) => f.tag === pathTag)
    if (at === -1) return outer
    const stored = utf16.decode(inner[at].body)
    const hit = byFrom.get(stored.normalize('NFC'))
    if (!hit) return outer
    const form = stored === stored.normalize('NFC') ? 'NFC' : 'NFD'
    const fields = inner.map((f, i): Frame => {
      if (i === at) return { tag: f.tag, body: utf16beOf(hit.to.normalize(form)) }
      const type = typeOf(hit.to)
      if (f.tag === 'ttyp' && type && type !== typeOf(hit.from))
        return { tag: f.tag, body: utf16beOf(type) }
      return f
    })
    moved.push(hit.from)
    changed = true
    return { tag: outer.tag, body: encodeFrames(fields) }
  })
  if (!changed) return { bytes, moved }
  const whole = framesOf(bytes)
  const tail = whole.truncated ? bytes.subarray(encodeFrames(frames).length) : new Uint8Array()
  const head = encodeFrames(out)
  const result = new Uint8Array(head.length + tail.length)
  result.set(head)
  result.set(tail, head.length)
  return { bytes: result, moved }
}

export function repointSeratoDatabase(
  bytes: Uint8Array,
  moves: SeratoMove[],
): { bytes: Uint8Array; moved: string[] } {
  return repointFrames(bytes, 'pfil', moves)
}

export function repointSeratoCrate(bytes: Uint8Array, moves: SeratoMove[]): Uint8Array {
  return repointFrames(bytes, 'ptrk', moves).bytes
}
