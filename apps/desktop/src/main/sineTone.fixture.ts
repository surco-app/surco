import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import type { UpdateExt } from './updateContract'

// The encoder settings the field round-trip tests write each container with.
export const CODEC: Record<UpdateExt, string[]> = {
  flac: ['-c:a', 'flac'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '320k'],
  aiff: ['-c:a', 'pcm_s16be'],
  wav: ['-c:a', 'pcm_s16le'],
  m4a: ['-c:a', 'alac'],
}

export const EXTS = Object.keys(CODEC) as UpdateExt[]

// A one-second untagged tone in the given container, for tests that tag it themselves.
export function encodeSine(dir: string, name: string, ext: UpdateExt): string {
  const file = join(dir, `${name}.${ext}`)
  execFileSync(ffmpegStatic as unknown as string, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...CODEC[ext],
    file,
  ])
  return file
}
