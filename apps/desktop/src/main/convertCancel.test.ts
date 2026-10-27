import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata, TrashEntry } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { configureBackupDiscarder, configureOriginalKeeper } from './originalKeeper'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cancel-'))
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
  // Long enough that killing the child mid-encode is reliably still in flight —
  // a stalled network mount is what this simulates, not a slow one.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=20',
    '-ar',
    '44100',
    '-ac',
    '2',
    src,
  ])
})

// Without a way to reach the child, cancelBatch only stops tracks not yet
// started — an already-running conversion (the one most likely to be the stuck
// one, on a dying network mount) keeps going forever. onChild is what a caller
// uses to kill it, mirroring what activeConversions.cancel() does in production.
describe('convertAudio — killed mid-encode', () => {
  it('rejects and leaves no .tmp file behind when the child is killed', async () => {
    const out = join(dir, 'killed.flac')
    const promise = convertAudio(
      src,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      (child) => child.kill('SIGTERM'),
    )

    await expect(promise).rejects.toThrow()
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  }, 15000)
})

describe('convertAudio — cancelled outside the encode', () => {
  it('publishes nothing when the cancel lands where no child process runs', async () => {
    const out = join(dir, 'cancelled.aiff')
    const promise = convertAudio(
      src,
      out,
      'aiff',
      meta,
      undefined,
      {
        mode: 'loudness',
        targetLufs: -9,
        truePeakDb: -1,
        peakDb: -1,
        removeDcOffset: false,
        peakPerChannel: false,
      },
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
      () => true,
    )

    await expect(promise).rejects.toThrow('conversionCancelled')
    expect(existsSync(out)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  }, 30000)

  // A cancel during the loudness measure used to let the full encode run anyway, only to
  // throw its output away at the end: minutes of a core on a long mix the user had stopped.
  it('never starts the encode once the job was cancelled before it', async () => {
    const onChild = vi.fn()
    const promise = convertAudio(
      src,
      join(dir, 'cancelled-before-encode.flac'),
      'flac',
      meta,
      undefined,
      {
        mode: 'loudness',
        targetLufs: -9,
        truePeakDb: -1,
        peakDb: -1,
        removeDcOffset: false,
        peakPerChannel: false,
      },
      undefined,
      undefined,
      onChild,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => true,
    )

    await expect(promise).rejects.toThrow('conversionCancelled')
    expect(onChild).not.toHaveBeenCalled()
  }, 30000)
})

// Backing up the original before the rename can take a whole copy on a NAS, and the
// copies queue one behind another: a track still waiting there when the user cancelled
// went on to replace its original anyway, as if the cancel had come too late.
describe('convertAudio — cancelled while the original is backed up', () => {
  it('leaves the original untouched and drops the backup it no longer needs', async () => {
    const file = join(dir, 'in-place.wav')
    copyFileSync(src, file)
    const before = readFileSync(file)
    const backup = { id: 'b1' } as TrashEntry
    let cancelled = false
    const discarded = vi.fn(async (_entry: TrashEntry) => {})
    configureOriginalKeeper(async () => {
      cancelled = true
      return backup
    })
    configureBackupDiscarder(discarded)
    try {
      const promise = convertAudio(
        file,
        file,
        'wav',
        { ...meta, title: 'Renamed In Tags' },
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
      )

      await expect(promise).rejects.toThrow('conversionCancelled')
    } finally {
      configureOriginalKeeper(null)
      configureBackupDiscarder(null)
    }
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(discarded).toHaveBeenCalledWith(backup)
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  }, 30000)
})

describe('convertAudio — encode killed by a cancel', () => {
  it('says the conversion was cancelled rather than echoing the ffmpeg command line', async () => {
    const out = join(dir, 'killed-by-cancel.flac')
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
  }, 15000)
})
