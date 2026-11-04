import { join } from 'node:path'
import { concat, frame, type RawFrame, rawFramesOf, utf16be } from '../shared/serato'
import type { SeratoLibraryRoot } from './seratoLibrary'

export type CrateTrack = { keep: number } | { path: string }

const utf16 = new TextDecoder('utf-16be')

function pathOf(track: RawFrame): string {
  const inner = rawFramesOf(track.body)
  const ptrk = inner?.find((f) => f.tag === 'ptrk')
  return ptrk ? utf16.decode(ptrk.body) : ''
}

export function crateTrackPaths(bytes: Uint8Array): string[] | null {
  const frames = rawFramesOf(bytes)
  if (!frames) return null
  return frames.filter((f) => f.tag === 'otrk').map(pathOf)
}

export function withCrateTracks(bytes: Uint8Array, tracks: CrateTrack[]): Uint8Array | null {
  const frames = rawFramesOf(bytes)
  if (!frames) return null
  const existing = frames.filter((f) => f.tag === 'otrk')
  const block: Uint8Array[] = []
  for (const track of tracks) {
    if ('keep' in track) {
      const kept = existing[track.keep]
      if (!kept) return null
      block.push(kept.raw)
    } else {
      block.push(frame('otrk', frame('ptrk', utf16be(track.path))))
    }
  }
  const first = frames.findIndex((f) => f.tag === 'otrk')
  const out: Uint8Array[] = []
  frames.forEach((f, i) => {
    if (i === first) out.push(...block)
    if (f.tag !== 'otrk') out.push(f.raw)
  })
  if (first === -1) out.push(...block)
  return concat(out)
}

export function validCrateName(name: string): boolean {
  return name.trim() !== '' && !name.includes('%%') && !name.includes('/')
}

export function crateIdOf(parentId: string, name: string): string {
  return parentId === 'root' ? name : `${parentId}%%${name}`
}

export function crateFamily(ids: Iterable<string>, id: string): string[] {
  return [...ids].filter((candidate) => candidate === id || candidate.startsWith(`${id}%%`))
}

export function renamedCrateId(id: string, renamed: string, name: string): string {
  const cut = renamed.lastIndexOf('%%')
  const parent = cut === -1 ? '' : renamed.slice(0, cut + 2)
  return `${parent}${name}${id.slice(renamed.length)}`
}

export function crateFileOf(root: SeratoLibraryRoot, id: string): string {
  return join(root.dir, 'Subcrates', `${id}.crate`)
}

const under = (file: string, root: string) =>
  file.toLowerCase().startsWith(`${root.toLowerCase()}/`)

export function seratoRootOf(file: string, roots: SeratoLibraryRoot[]): SeratoLibraryRoot | null {
  const external = roots.find((r) => r.root !== '/' && under(file, r.root))
  if (external) return external
  if (under(file, '/Volumes')) return null
  return roots.find((r) => r.root === '/') ?? null
}

export function seratoPathOn(file: string, root: SeratoLibraryRoot): string {
  const rest = root.root !== '/' && under(file, root.root) ? file.slice(root.root.length) : file
  return rest.replace(/^\/+/, '')
}

export function seratoLinkId(index: number, crateFile: string, path: string): string {
  return `${index}:${encodeURIComponent(crateFile)}:${encodeURIComponent(path)}`
}

export function parseSeratoLinkId(
  linkId: string,
): { index: number; crateFile: string; path: string } | null {
  const match = linkId.match(/^(\d+):([^:]+):([^:]+)$/)
  if (!match) return null
  try {
    return {
      index: Number(match[1]),
      crateFile: decodeURIComponent(match[2]),
      path: decodeURIComponent(match[3]),
    }
  } catch {
    return null
  }
}
