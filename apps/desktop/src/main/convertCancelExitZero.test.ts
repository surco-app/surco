import type * as ChildProcess from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  const { promisify } = await import('node:util')
  const realExecFileAsync = promisify(actual.execFile)
  const writesTheTemp = (args: string[]) => args.some((a) => a.includes('.tmp-'))
  const execFile = Object.assign(
    (...params: Parameters<typeof actual.execFile>) => actual.execFile(...params),
    {
      [promisify.custom]: (file: string, args: string[], opts: object) => {
        if (!writesTheTemp(args)) return realExecFileAsync(file, args, opts)
        let exitCleanly: (out: { stdout: string; stderr: string }) => void = () => {}
        const pending = new Promise((resolve) => {
          exitCleanly = resolve
        })
        return Object.assign(pending, {
          child: { kill: () => exitCleanly({ stdout: '', stderr: '' }) },
        })
      },
    },
  )
  return { ...actual, execFile }
})

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cancel-exit0-'))
const src = join(dir, 'in.wav')

const meta: TrackMetadata = {
  title: 'Long One',
  artist: 'Test',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

beforeAll(() => {
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', src])
})

describe('convertAudio — encode that exits cleanly after a cancel killed it', () => {
  it('reports the cancel instead of tagging a temp file ffmpeg never wrote', async () => {
    const out = join(dir, 'exit-zero.flac')
    let cancelled = false
    const promise = convertAudio(
      src,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      (child) => {
        cancelled = true
        child.kill('SIGTERM')
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => cancelled,
    )

    await expect(promise).rejects.toThrow(/^SURCO_ERR:conversionCancelled$/)
    expect(readdirSync(dir).sort()).toEqual(['in.wav'])
  }, 15000)
})
