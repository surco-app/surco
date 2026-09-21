import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { BackupPolicy } from '../shared/backupPolicy'
import type { NormalizeConfig, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { configureOriginalKeeper } from './originalKeeper'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-backup-'))

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
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

// A fresh AIFF per case: the rewrite lands on the source's own path, so cases cannot
// share one file.
let n = 0
function sourceAiff(): string {
  const path = join(dir, `in${n++}.aiff`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    path,
  ])
  return path
}

// Rewrites the file onto itself — the overwrite destination — and reports which paths
// the write path handed to the trash, with a keeper standing in for the real one the
// way index.ts wires it at launch. Only the two arguments this behaviour turns on are
// named; everything else convertAudio takes stays at its default.
async function rewriteInPlace(opts: {
  backupPolicy?: BackupPolicy
  normalize?: NormalizeConfig
}): Promise<string[]> {
  const src = sourceAiff()
  const kept: string[] = []
  configureOriginalKeeper(async (path) => {
    kept.push(path)
    return null
  })
  await convertAudio(
    src,
    src,
    'aiff',
    meta,
    undefined,
    opts.normalize,
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
    { backupPolicy: opts.backupPolicy },
  )
  // The path is generated per case, so assert on it rather than on a bare count.
  return kept.map((p) => (p === src ? 'the original' : p))
}

const PEAK: NormalizeConfig = { mode: 'peak', targetLufs: -14, peakDb: -1, truePeakDb: -1 }

afterEach(() => configureOriginalKeeper(null))

describe('backup policy on an in-place rewrite', () => {
  // The case measured on 21/09/2026: an AIFF rewritten as AIFF to edit its tags stream
  // copies the audio, and archiving the whole 65 MB on every metadata edit is what filled
  // the cap with copies of files that were never going to sound different.
  it('keeps nothing when only the tags change and the policy is audioChanges', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'audioChanges' })).toEqual([])
  })

  // Normalizing re-renders the samples, so the original cannot be reconstructed from the
  // result: this is the case the backup exists for, and the middle level keeps it.
  it('keeps the original when the audio is re-encoded and the policy is audioChanges', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'audioChanges', normalize: PEAK })).toEqual([
      'the original',
    ])
  })

  // The default, and what Surco did before the setting existed: every in-place rewrite
  // stays undoable, tags-only ones included.
  it('keeps the original for a tags-only rewrite when the policy is always', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'always' })).toEqual(['the original'])
  })

  // An absent policy is the pre-setting behaviour, so an old settings file, or any caller
  // not yet taught the argument, keeps protecting the user rather than silently dropping
  // the net.
  it('keeps the original when no policy is passed at all', async () => {
    expect(await rewriteInPlace({})).toEqual(['the original'])
  })

  // 'never' is the only level that removes the net, and it has to do it even where the
  // file is most at risk — a re-encode, where the original samples are gone once the
  // rename lands.
  it('keeps nothing under never, re-encode included', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'never', normalize: PEAK })).toEqual([])
  })
})
