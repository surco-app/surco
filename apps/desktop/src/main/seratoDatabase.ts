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
