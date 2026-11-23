import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-m4a-sources-'))
let n = 0

function m4a(codec: 'aac' | 'alac'): string {
  const path = join(dir, `src${n++}.m4a`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=2',
    '-c:a',
    codec,
    path,
  ])
  return path
}

function tagNames(path: string): string[] {
  return String(execFileSync(FF, ['-loglevel', 'error', '-i', path, '-f', 'ffmetadata', '-']))
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).toLowerCase())
}

async function convert(src: string, target: OutputFormat): Promise<string> {
  const out = join(dir, `out${n++}.${target === 'alac' ? 'm4a' : target}`)
  await convertAudio(src, out, target, { ...(await readMeta(src)).tags, title: 'New title' })
  return out
}

// ffmpeg reads an MP4's file-type box as three tags and wrote them into every MP3, AIFF and
// FLAC made from an M4A: rows the DJ never wrote, naming a container the file is not.
describe.each(['aac', 'alac'] as const)('an %s M4A', (codec) => {
  it.each(['mp3', 'aiff', 'wav', 'flac'] as OutputFormat[])(
    'leaves its container brands out of %s',
    async (target) => {
      const names = await convert(m4a(codec), target).then(tagNames)
      expect(
        names.filter((name) =>
          ['major_brand', 'minor_version', 'compatible_brands'].includes(name),
        ),
      ).toEqual([])
    },
  )
})
