import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { TrackMetadata } from '../shared/types'

const run = promisify(execFile)

interface ProbeResult {
  sampleFmt: string
  bitsPerRawSample: number
  sampleRate: string
  channels: number
}

export async function probeAudio(input: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_fmt,bits_per_raw_sample,sample_rate,channels',
    '-of', 'json',
    input
  ])
  const stream = JSON.parse(stdout).streams?.[0] ?? {}
  return {
    sampleFmt: stream.sample_fmt ?? 's16',
    bitsPerRawSample: Number(stream.bits_per_raw_sample) || 0,
    sampleRate: String(stream.sample_rate ?? ''),
    channels: Number(stream.channels) || 2
  }
}

// Picks a big-endian PCM codec for AIFF that preserves the source bit depth
// exactly (lossless). Never downsamples bit depth.
function aiffCodec(probe: ProbeResult): string {
  if (probe.sampleFmt.startsWith('f')) return 'pcm_f32be'
  const bits = probe.bitsPerRawSample || (probe.sampleFmt.includes('32') ? 32 : probe.sampleFmt.includes('16') ? 16 : 24)
  if (bits >= 32) return 'pcm_s32be'
  if (bits >= 24) return 'pcm_s24be'
  return 'pcm_s16be'
}

function metadataArgs(meta: TrackMetadata): string[] {
  const pairs: [string, string][] = [
    ['title', meta.title],
    ['artist', meta.artist],
    ['album', meta.album],
    ['album_artist', meta.albumArtist],
    ['date', meta.year],
    ['genre', meta.genre],
    ['grouping', meta.grouping],
    ['comment', meta.comment],
    ['track', meta.trackNumber]
  ]
  return pairs.filter(([, v]) => v && v.trim()).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
}

export async function convertToAiff(
  input: string,
  output: string,
  meta: TrackMetadata,
  coverPath?: string
): Promise<void> {
  const probe = await probeAudio(input)
  const codec = aiffCodec(probe)

  const args = ['-y', '-i', input]
  if (coverPath) args.push('-i', coverPath)

  args.push('-map', '0:a')
  if (coverPath) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')

  args.push('-c:a', codec, '-write_id3v2', '1', '-id3v2_version', '3')
  args.push(...metadataArgs(meta))
  args.push(output)

  await run('ffmpeg', args, { maxBuffer: 1024 * 1024 * 32 })
}

export async function generateSpectrogram(input: string): Promise<string> {
  const out = join(tmpdir(), `vinilo-spec-${Date.now()}.png`)
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-lavfi', 'showspectrumpic=s=1000x280:legend=0:color=intensity:gain=2',
      out
    ])
    const buf = await readFile(out)
    return `data:image/png;base64,${buf.toString('base64')}`
  } finally {
    await unlink(out).catch(() => {})
  }
}

export async function processCover(
  input: string,
  opts: { maxSize: number; square: boolean }
): Promise<string> {
  const max = opts.maxSize > 0 ? opts.maxSize : 4000
  const scale = `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`
  const vf = opts.square ? `crop='min(iw,ih)':'min(iw,ih)',${scale}` : scale
  const out = join(tmpdir(), `vinilo-cover-proc-${Date.now()}.jpg`)
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-vf', vf,
    '-q:v', '2',
    out
  ])
  return out
}

export async function analyzeCutoff(input: string): Promise<number> {
  const stats = join(tmpdir(), `vinilo-stats-${Date.now()}.txt`)
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', input,
      '-af', `aspectralstats=measure=rolloff,ametadata=mode=print:file=${stats}`,
      '-f', 'null', '-'
    ], { maxBuffer: 1024 * 1024 * 16 })
    const text = await readFile(stats, 'utf-8')
    return [...text.matchAll(/rolloff=([\d.]+)/g)].reduce((max, m) => Math.max(max, Number(m[1])), 0)
  } finally {
    await unlink(stats).catch(() => {})
  }
}
