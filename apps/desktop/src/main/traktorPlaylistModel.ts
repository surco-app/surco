import { attr, withAttr } from './traktorNml'

// Traktor's <PLAYLISTS> as a tree that remembers the text each node was read from. An edit
// marks the nodes it changes; serializing rewrites those (and the folders holding them) and
// copies every other node verbatim, so a save never reformats the DJ's whole tree.

export interface ModelRow {
  key: string
  text: string
}

export interface ModelNode {
  id: string
  kind: 'folder' | 'playlist' | 'smartlist'
  name: string
  uuid: string
  open: string
  inner: string
  rows: ModelRow[]
  children: ModelNode[]
  parent: ModelNode | null
  text: string
  dirty: boolean
}

export interface PlaylistModel {
  root: ModelNode
  start: number
  end: number
  eol: string
}

function skipSpace(nml: string, at: number): number {
  while (at < nml.length && /\s/.test(nml[at])) at++
  return at
}

function tagAt(nml: string, at: number): string | null {
  const end = nml.indexOf('>', at)
  return end < 0 ? null : nml.slice(at, end + 1)
}

// Reads one NODE, or null when the text is not shaped as Traktor writes it (cut short, a
// raw ">" in a name, a folder or playlist missing its list): a tree Surco cannot follow
// is not read at all, rather than guessed at and written back.
function parseNode(nml: string, start: number, parent: ModelNode | null): ModelNode | null {
  const open = tagAt(nml, start)
  if (!open?.startsWith('<NODE')) return null
  const type = attr(open, 'TYPE')
  const node: ModelNode = {
    id: '',
    kind: type === 'FOLDER' ? 'folder' : type === 'PLAYLIST' ? 'playlist' : 'smartlist',
    name: attr(open, 'NAME'),
    uuid: '',
    open,
    inner: '',
    rows: [],
    children: [],
    parent,
    text: '',
    dirty: false,
  }
  let at = start + open.length
  if (open.endsWith('/>')) {
    if (node.kind !== 'smartlist') return null
    node.text = open
    return node
  }
  if (node.kind === 'smartlist') {
    const close = nml.indexOf('</NODE>', at)
    if (close < 0) return null
    node.text = nml.slice(start, close + '</NODE>'.length)
    return node
  }
  const list = node.kind === 'folder' ? 'SUBNODES' : 'PLAYLIST'
  at = skipSpace(nml, at)
  const inner = tagAt(nml, at)
  if (!inner?.startsWith(`<${list}`)) return null
  node.inner = inner
  node.uuid = node.kind === 'playlist' ? attr(inner, 'UUID') : ''
  at += inner.length
  if (!inner.endsWith('/>'))
    for (;;) {
      at = skipSpace(nml, at)
      if (nml.startsWith(`</${list}>`, at)) {
        at += `</${list}>`.length
        break
      }
      if (node.kind === 'folder') {
        const child = parseNode(nml, at, node)
        if (!child) return null
        node.children.push(child)
        at += child.text.length
      } else {
        if (!nml.startsWith('<ENTRY', at)) return null
        const end = nml.indexOf('</ENTRY>', at)
        if (end < 0) return null
        const text = nml.slice(at, end + '</ENTRY>'.length)
        node.rows.push({ key: attr(text.match(/<PRIMARYKEY\b[^>]*>/)?.[0] ?? '', 'KEY'), text })
        at += text.length
      }
    }
  at = skipSpace(nml, at)
  if (!nml.startsWith('</NODE>', at)) return null
  node.text = nml.slice(start, at + '</NODE>'.length)
  return node
}

// Folders are named by their path; a second sibling folder of the same name takes its
// ordinal, so two "Sets" folders never share an id.
function assignIds(node: ModelNode, path: string[]): void {
  const seen = new Map<string, number>()
  for (const child of node.children) {
    const n = (seen.get(child.name) ?? 0) + 1
    seen.set(child.name, n)
    const segment = n > 1 ? `${child.name}#${n}` : child.name
    const childPath = [...path, segment]
    child.id =
      child.kind === 'playlist' && child.uuid ? child.uuid : `folder:${childPath.join('/')}`
    if (child.kind === 'smartlist') child.id = `smartlist:${childPath.join('/')}`
    assignIds(child, childPath)
  }
}

export function parsePlaylists(nml: string): PlaylistModel | null {
  const section = nml.indexOf('<PLAYLISTS>')
  if (section < 0) return null
  const start = nml.indexOf('<NODE', section)
  if (start < 0) return null
  const root = parseNode(nml, start, null)
  if (!root) return null
  root.id = 'root'
  assignIds(root, [])
  return { root, start, end: start + root.text.length, eol: nml.includes('\r\n') ? '\r\n' : '\n' }
}

function find(node: ModelNode, id: string): ModelNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const hit = find(child, id)
    if (hit) return hit
  }
  return null
}

export function nodeById(model: PlaylistModel | null, id: string): ModelNode | null {
  return model ? find(model.root, id) : null
}

// A row is named by its playlist, its place and the track it holds there: the place alone
// would name another track once Traktor reorders the playlist behind a list Surco shows.
export function rowLinkId(node: ModelNode, index: number): string {
  return `${node.uuid}:${index}:${node.rows[index]?.key ?? ''}`
}

function changed(node: ModelNode): boolean {
  return node.dirty || node.children.some(changed)
}

function render(node: ModelNode, eol: string): string {
  if (!changed(node)) return node.text
  if (node.kind === 'folder') {
    const inner = withAttr(node.inner.replace(/\/>$/, '>'), 'COUNT', String(node.children.length))
    const body = node.children.map((c) => `${render(c, eol)}${eol}`).join('')
    return `${node.open}${inner}${body ? `${eol}${body}` : ''}</SUBNODES>${eol}</NODE>`
  }
  const inner = withAttr(node.inner.replace(/\/>$/, '>'), 'ENTRIES', String(node.rows.length))
  const body = node.rows.map((r) => `${r.text}${eol}`).join('')
  return `${node.open}${inner}${body}</PLAYLIST>${eol}</NODE>`
}

export function serializePlaylists(nml: string, model: PlaylistModel | null): string {
  if (!model || !changed(model.root)) return nml
  return `${nml.slice(0, model.start)}${render(model.root, model.eol)}${nml.slice(model.end)}`
}

// FNV-1a over what the DJ would see change: a playlist's rows in order, a folder's children.
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function stampOf(node: ModelNode): number {
  return node.kind === 'folder'
    ? hash(node.children.map((c) => `${c.kind}\0${c.name}`).join('\n'))
    : hash(`${node.name}\n${node.rows.map((r) => r.key).join('\n')}`)
}

// The stamps of a node and of everything below it, for a delete that takes them all.
export function traktorSubtreeStamps(nml: string, id: string): Record<string, number> {
  const out: Record<string, number> = {}
  const walk = (node: ModelNode): void => {
    out[node.id] = stampOf(node)
    node.children.forEach(walk)
  }
  const node = nodeById(parsePlaylists(nml), id)
  if (node) walk(node)
  return out
}

export function traktorStamps(nml: string): Record<string, number> {
  const model = parsePlaylists(nml)
  const out: Record<string, number> = {}
  const walk = (node: ModelNode): void => {
    out[node.id] = stampOf(node)
    node.children.forEach(walk)
  }
  if (model) walk(model.root)
  return out
}
