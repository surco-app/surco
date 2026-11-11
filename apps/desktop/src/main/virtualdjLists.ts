import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { attr } from './traktorNml'

export interface VirtualdjNode {
  id: string
  name: string
  kind: 'folder' | 'playlist'
  paths: string[]
  children?: VirtualdjNode[]
}

export const EXT = '.vdjfolder'
export const SUB = '.subfolders'
const SONG_RE = /<song\b((?:"[^"]*"|[^>"])*)>/g

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export interface VirtualdjListRow {
  path: string
  start: number
  end: number
}

export function virtualdjListRows(xml: string): VirtualdjListRow[] {
  const entries = [...xml.matchAll(SONG_RE)].map((m, at) => {
    const idx = Number.parseInt(attr(m[1], 'idx'), 10)
    const start = m.index
    return {
      path: attr(m[1], 'path'),
      idx: Number.isNaN(idx) ? null : idx,
      at,
      start,
      end: start + m[0].length,
    }
  })
  const withPath = entries.filter((e) => e.path)
  const ordered = withPath.some((e) => e.idx === null)
    ? withPath
    : withPath.sort((a, b) => (a.idx as number) - (b.idx as number) || a.at - b.at)
  return ordered.map(({ path, start, end }) => ({ path, start, end }))
}

const readPaths = (file: string): string[] => virtualdjListRows(readText(file)).map((r) => r.path)

export function virtualdjLinkId(index: number, path: string): string {
  return `${index}:${encodeURIComponent(path)}`
}

export function parseVirtualdjLinkId(linkId: string): { index: number; path: string } | null {
  const match = linkId.match(/^(\d+):(.+)$/)
  if (!match) return null
  try {
    return { index: Number(match[1]), path: decodeURIComponent(match[2]) }
  } catch {
    return null
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readLevel(dir: string, prefix: string): VirtualdjNode[] {
  if (!isDir(dir)) return []
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const present = new Set(files.filter((f) => f.endsWith(EXT)).map((f) => f.slice(0, -EXT.length)))
  const ordered = readText(join(dir, 'order'))
    .split(/\r?\n/)
    .filter((n) => present.has(n))
  const names = [...new Set(ordered)]
  const rest = [...present].filter((n) => !names.includes(n)).sort()
  return [...names, ...rest].map((name) => {
    const id = `${prefix}${name}`
    const file = join(dir, `${name}${EXT}`)
    const sub = join(dir, `${name}${SUB}`)
    if (isDir(sub))
      return { id, name, kind: 'folder', paths: [], children: readLevel(sub, `${id}/`) }
    return { id, name, kind: 'playlist', paths: isDir(file) ? [] : readPaths(file) }
  })
}

export function readVirtualdjLists(dir: string): VirtualdjNode[] {
  if (!existsSync(dir)) return []
  return readLevel(dir, '')
}
