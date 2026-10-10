import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
  signal?: keyof typeof SIGNALS
}

const SIGNALS = {
  tone: 'aevalsrc=0.3*sin(2*PI*220*t)+0.1*sin(2*PI*3000*t):s=44100:d=4',
  noise: 'anoisesrc=color=pink:amplitude=0.4:duration=8:sample_rate=44100',
  kick: 'aevalsrc=0.95*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=8',
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
    SIGNALS[spec.signal ?? 'tone'],
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

export function lossyCopy(source: string, target: string, kbps = 128): string {
  mkdirSync(dirname(target), { recursive: true })
  const mp3 = `${target}.tmp.mp3`
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', source, '-b:a', `${kbps}k`, mp3])
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', mp3, target])
  unlinkSync(mp3)
  return target
}

function prependId3Priv(path: string): void {
  writeFileSync(path, Buffer.concat([id3WithPriv(cueTree()), readFileSync(path)]))
}

export function audioMd5(path: string): string {
  return execFileSync(FF, ['-loglevel', 'error', '-i', path, '-map', '0:a', '-f', 'md5', '-'])
    .toString()
    .trim()
}

export function loudness(path: string): { integrated: number; truePeak: number } {
  const log = spawnSync(FF, [
    '-nostats',
    '-i',
    path,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]).stderr.toString()
  const summary = log.slice(log.lastIndexOf('Summary:'))
  const number = (label: RegExp): number => Number(summary.match(label)?.[1])
  return {
    integrated: number(/I:\s+(-?[\d.]+) LUFS/),
    truePeak: number(/Peak:\s+(-?[\d.]+) dBFS/),
  }
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

export function coverJpg(path: string, hue = 180): string {
  writeFileSync(path, coverBytes(hue))
  return path
}

export function coverDataUrl(): string {
  return `data:image/jpeg;base64,${coverBytes(30).toString('base64')}`
}

function coverBytes(hue: number): Buffer {
  return execFileSync(FF, [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `mandelbrot=s=600x600,hue=h=${hue}`,
    '-frames:v',
    '1',
    '-q:v',
    '6',
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
