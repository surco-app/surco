import { join } from 'node:path'
import type { SeratoLibraryRoot } from './seratoLibrary'

export type CrateTrack = { keep: number } | { path: string }

interface RawFrame {
  tag: string
  body: Uint8Array
  raw: Uint8Array
}

const utf16 = new TextDecoder('utf-16be')

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

function utf16beOf(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i))
  return out
}

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
      block.push(frameOf('otrk', frameOf('ptrk', utf16beOf(track.path))))
    }
  }
  const first = frames.findIndex((f) => f.tag === 'otrk')
  const out: Uint8Array[] = []
  frames.forEach((f, i) => {
    if (i === first) out.push(...block)
    if (f.tag !== 'otrk') out.push(f.raw)
  })
  if (first === -1) out.push(...block)
  return concatBytes(out)
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
