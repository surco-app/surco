import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { Picture, PictureType, File as TagFile } from 'node-taglib-sharp'
import { encodeBase91 } from '../main/base91'
import {
  buildTraktorTree,
  id3WithPriv,
  injectAiffPriv,
  injectWavPriv,
  traktorCue,
} from '../main/traktor4Fixture'
import type { Release } from '../shared/types'

const FF = ffmpegStatic as unknown as string

export const DROP_MS = 79672.64

export function cueTree(): Uint8Array {
  return buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, DROP_MS, 1)])
}

export interface TrackSpec {
  title: string
  artist: string
  album?: string
  grouping?: string
  publisher?: string
  bpm?: number
  comment?: string
  coverJpg?: string
  withCues?: boolean
}

export function makeTrack(path: string, spec: TrackSpec): string {
  mkdirSync(dirname(path), { recursive: true })
  const isFlac = path.endsWith('.flac')
  const cues = spec.withCues && isFlac ? ['-metadata', `TRAKTOR4=${encodeBase91(cueTree())}`] : []
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.3*sin(2*PI*220*t)+0.1*sin(2*PI*3000*t):s=44100:d=4',
    '-ac',
    '2',
    ...cues,
    path,
  ])
  if (spec.withCues && !isFlac) {
    if (path.endsWith('.wav')) injectWavPriv(path, cueTree())
    else if (path.endsWith('.aiff')) injectAiffPriv(path, cueTree())
    else if (path.endsWith('.mp3')) prependId3Priv(path)
  }
  const file = TagFile.createFromPath(path)
  try {
    file.tag.title = spec.title
    file.tag.performers = [spec.artist]
    if (spec.album) file.tag.album = spec.album
    if (spec.grouping) file.tag.grouping = spec.grouping
    if (spec.publisher) file.tag.publisher = spec.publisher
    if (spec.bpm) file.tag.beatsPerMinute = spec.bpm
    if (spec.comment) file.tag.comment = spec.comment
    if (spec.coverJpg) {
      const picture = Picture.fromPath(spec.coverJpg)
      picture.type = PictureType.FrontCover
      file.tag.pictures = [picture]
    }
    file.save()
  } finally {
    file.dispose()
  }
  return path
}

function prependId3Priv(path: string): void {
  writeFileSync(path, Buffer.concat([id3WithPriv(cueTree()), readFileSync(path)]))
}

export function audioMd5(path: string): string {
  return execFileSync(FF, ['-loglevel', 'error', '-i', path, '-map', '0:a', '-f', 'md5', '-'])
    .toString()
    .trim()
}

export function listFiles(root: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [relative(root, full)]
    })
  return walk(root).sort()
}

export function embeddedCover(path: string): Buffer | null {
  const file = TagFile.createFromPath(path)
  try {
    const picture = file.tag.pictures[0]
    return picture ? Buffer.from(picture.data.toByteArray()) : null
  } finally {
    file.dispose()
  }
}

export function coverJpg(path: string, color = 'teal'): string {
  writeFileSync(path, coverBytes(color))
  return path
}

export function coverDataUrl(): string {
  return `data:image/jpeg;base64,${coverBytes('orange').toString('base64')}`
}

function coverBytes(color: string): Buffer {
  return execFileSync(FF, [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=600x600:d=1`,
    '-frames:v',
    '1',
    '-f',
    'mjpeg',
    '-',
  ])
}

export function release(over: Partial<Release> & Pick<Release, 'tracklist'>): Release {
  return {
    provider: 'discogs',
    id: 1,
    title: 'Movin Melodies',
    artists: [{ name: 'ATB' }],
    year: 1999,
    genres: ['Electronic'],
    styles: ['Trance'],
    labels: [{ name: 'Kontor', catno: 'KON-123' }],
    images: [{ uri: coverDataUrl(), type: 'primary', resource_url: '' }],
    ...over,
  }
}
