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

const EXT = '.vdjfolder'
const SUB = '.subfolders'
const SONG_RE = /<song\b((?:"[^"]*"|[^>"])*)>/g

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readPaths(file: string): string[] {
  const entries = [...readText(file).matchAll(SONG_RE)].map((m, at) => {
    const idx = Number.parseInt(attr(m[1], 'idx'), 10)
    return { path: attr(m[1], 'path'), idx: Number.isNaN(idx) ? null : idx, at }
  })
  const withPath = entries.filter((e) => e.path)
  if (withPath.some((e) => e.idx === null)) return withPath.map((e) => e.path)
  return withPath
    .sort((a, b) => (a.idx as number) - (b.idx as number) || a.at - b.at)
    .map((e) => e.path)
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
