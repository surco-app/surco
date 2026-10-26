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
}

function skipSpace(nml: string, at: number): number {
  while (at < nml.length && /\s/.test(nml[at])) at++
  return at
}

function tagAt(nml: string, at: number): string {
  return nml.slice(at, nml.indexOf('>', at) + 1)
}

function parseNode(nml: string, start: number, parent: ModelNode | null): ModelNode {
  const open = tagAt(nml, start)
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
    node.text = open
    return node
  }
  if (node.kind === 'folder') {
    at = skipSpace(nml, at)
    node.inner = tagAt(nml, at)
    at += node.inner.length
    if (!node.inner.endsWith('/>'))
      for (;;) {
        at = skipSpace(nml, at)
        if (nml.startsWith('</SUBNODES>', at)) {
          at += '</SUBNODES>'.length
          break
        }
        const child = parseNode(nml, at, node)
        node.children.push(child)
        at += child.text.length
      }
  } else if (node.kind === 'playlist') {
    at = skipSpace(nml, at)
    node.inner = tagAt(nml, at)
    node.uuid = attr(node.inner, 'UUID')
    at += node.inner.length
    if (!node.inner.endsWith('/>'))
      for (;;) {
        at = skipSpace(nml, at)
        if (nml.startsWith('</PLAYLIST>', at)) {
          at += '</PLAYLIST>'.length
          break
        }
        const close = nml.indexOf('</ENTRY>', at) + '</ENTRY>'.length
        const text = nml.slice(at, close)
        node.rows.push({ key: attr(text.match(/<PRIMARYKEY\b[^>]*>/)?.[0] ?? '', 'KEY'), text })
        at = close
      }
  }
  const close = nml.indexOf('</NODE>', at) + '</NODE>'.length
  node.text = nml.slice(start, close)
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
  root.id = 'root'
  assignIds(root, [])
  return { root, start, end: start + root.text.length }
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

export function rowLinkId(node: ModelNode, index: number): string {
  return `${node.uuid}:${index}`
}

function changed(node: ModelNode): boolean {
  return node.dirty || node.children.some(changed)
}

function render(node: ModelNode): string {
  if (!changed(node)) return node.text
  if (node.kind === 'folder') {
    const inner = withAttr(node.inner.replace(/\/>$/, '>'), 'COUNT', String(node.children.length))
    const body = node.children.map((c) => `${render(c)}\n`).join('')
    return `${node.open}${inner}${body ? `\n${body}` : ''}</SUBNODES>\n</NODE>`
  }
  const inner = withAttr(node.inner.replace(/\/>$/, '>'), 'ENTRIES', String(node.rows.length))
  const body = node.rows.map((r) => `${r.text}\n`).join('')
  return `${node.open}${inner}${body}</PLAYLIST>\n</NODE>`
}

export function serializePlaylists(nml: string, model: PlaylistModel | null): string {
  if (!model || !changed(model.root)) return nml
  return `${nml.slice(0, model.start)}${render(model.root)}${nml.slice(model.end)}`
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
