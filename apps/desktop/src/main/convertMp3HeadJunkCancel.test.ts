import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

let cancelled = false
const signals: (AbortSignal | undefined)[] = []
vi.mock('./verifyPcm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verifyPcm')>()
  return {
    ...actual,
    pcmDigest: async (file: string, opts: Parameters<typeof actual.pcmDigest>[1] = {}) => {
      signals.push(opts.signal)
      cancelled = true
      await new Promise((resolve) => setTimeout(resolve, 300))
      return actual.pcmDigest(file, opts)
    },
  }
})

import { errorKeyOf } from '../shared/errorKeys'
import { emptyMetadata } from '../shared/metadata'
import { convertAudio } from './ffmpeg'
import { leadingId3v2Size } from './id3Header'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-headjunk-cancel-'))

// The digest of the absorbed copy is a decode like the others before the rename: a cancel
// has to reach it too, not wait it out.
describe('cancelling the copy of an MP3 with junk ahead of its first frame', () => {
  it('stops the digest of the absorbed copy', async () => {
    const clean = join(dir, 'clean.mp3')
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=2', clean])
    const bytes = readFileSync(clean)
    const head = leadingId3v2Size(bytes)
    const src = join(dir, 'in.mp3')
    writeFileSync(
      src,
      Buffer.concat([bytes.subarray(0, head), Buffer.alloc(4000), bytes.subarray(head)]),
    )
    const failure = await convertAudio(
      src,
      join(dir, 'out.mp3'),
      'mp3',
      { ...emptyMetadata(), title: 'T' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => cancelled,
    ).catch((e: unknown) => e)
    expect(signals[0]?.aborted).toBe(true)
    expect(errorKeyOf((failure as Error).message)).toBe('conversionCancelled')
  }, 30_000)
})
