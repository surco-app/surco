import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { BackupPolicy } from '../shared/backupPolicy'
import type { NormalizeConfig, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { configureBackupStore, configureOriginalKeeper, policyKeeper } from './originalKeeper'

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

// Rewrites the file onto itself — the overwrite destination — through the real keeper
// the app installs, so this exercises the whole chain: convertAudio reports what the
// encode did, and the policy decides. Returns which paths reached the store.
async function rewriteInPlace(opts: {
  backupPolicy: BackupPolicy
  normalize?: NormalizeConfig
}): Promise<string[]> {
  const src = sourceAiff()
  const kept: string[] = []
  configureOriginalKeeper(
    policyKeeper(
      () => opts.backupPolicy,
      async (path) => {
        kept.push(path)
        return null
      },
    ),
  )
  await convertAudio(src, src, 'aiff', meta, undefined, opts.normalize)
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
  // result: this is the case the backup exists for, and the middle level keeps it. It is
  // also what proves convertAudio reports the encode honestly — the policy alone cannot
  // tell a stream copy from a re-encode.
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

  // 'never' removes the net only once the self-check has read the new file back: the
  // rename lands before that verdict, so the original is held until it answers (see
  // settleHeldOriginal), and a file that does not add up still has its original.
  // A tag-only update copies the audio through: never treats it as audioChanges does and
  // holds nothing for the self-check.
  it('holds nothing under never when only the tags change', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'never' })).toEqual([])
  })

  it('holds the original under never until the self-check answers', async () => {
    expect(await rewriteInPlace({ backupPolicy: 'never', normalize: PEAK })).toEqual([
      'the original',
    ])
  })
})

// Copias short of room sends the original to the system Trash instead. That used to happen
// inside the keeper, before the last cancel check and the rename: a cancel there, or a
// rename that never landed, left the track in neither its folder nor Copias, with every DJ
// library pointing at a file that was gone.
describe('an in-place rewrite when Copias has no room', () => {
  function noRoomStore(onStash: () => void = () => {}): string[] {
    const trashed: string[] = []
    configureBackupStore(
      {
        stash: async () => {
          onStash()
          return null
        },
        remove: async () => {},
      },
      () => 'always',
      async (path) => {
        const to = join(mkdtempSync(join(dir, 'system-trash-')), basename(path))
        renameSync(path, to)
        trashed.push(to)
      },
    )
    return trashed
  }

  it('leaves the original on its path when the user cancels before the rename', async () => {
    const src = sourceAiff()
    const before = readFileSync(src)
    let cancelled = false
    const trashed = noRoomStore(() => {
      cancelled = true
    })
    await expect(
      convertAudio(
        src,
        src,
        'aiff',
        meta,
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
      ),
    ).rejects.toThrow('conversionCancelled')
    expect(readFileSync(src)).toEqual(before)
    expect(trashed).toEqual([])
  })

  it('leaves a different file the user chose to overwrite in place on a cancel', async () => {
    const src = sourceAiff()
    const other = sourceAiff()
    const before = readFileSync(other)
    let cancelled = false
    const trashed = noRoomStore(() => {
      cancelled = true
    })
    await expect(
      convertAudio(
        src,
        other,
        'aiff',
        meta,
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
        true,
      ),
    ).rejects.toThrow('conversionCancelled')
    expect(readFileSync(other)).toEqual(before)
    expect(trashed).toEqual([])
  })

  it('still sends the original to the system Trash once the new file is on its path', async () => {
    const src = sourceAiff()
    const before = readFileSync(src)
    const trashed = noRoomStore()
    await convertAudio(src, src, 'aiff', { ...meta, title: 'New' })
    expect(trashed).toHaveLength(1)
    expect(basename(trashed[0])).toBe(basename(src))
    expect(readFileSync(trashed[0])).toEqual(before)
    expect(readFileSync(src)).not.toEqual(before)
    expect(readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([])
  })
})
