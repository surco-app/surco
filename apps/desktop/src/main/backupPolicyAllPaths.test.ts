import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { BackupPolicy } from '../shared/backupPolicy'
import { removeRenamedOriginal } from './inplace'
import {
  claimHeldOriginal,
  configureBackupStore,
  configureOriginalKeeper,
  policyKeeper,
  settleHeldOriginal,
} from './originalKeeper'
import { createSurcoTrash } from './surcoTrash'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-allpaths-'))

let n = 0
function pair(): { input: string; output: string } {
  const id = n++
  const input = join(dir, `src${id}.wav`)
  const output = join(dir, `src${id}.flac`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    input,
  ])
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', input, output])
  return { input, output }
}

function install(policy: BackupPolicy): string[] {
  const kept: string[] = []
  configureOriginalKeeper(
    policyKeeper(
      () => policy,
      async (path) => {
        kept.push(path)
        // A real stash MOVES the file; returning an entry is what tells the caller not
        // to unlink it itself, so the stand-in has to do both to model the contract.
        writeFileSync(join(dir, `stashed-${n}`), '')
        return {
          id: 'x',
          name: 'x',
          originalPath: path,
          storedPath: '',
          bytes: 0,
          trashedAt: 0,
          reason: 'renamed',
        }
      },
    ),
  )
  return kept
}

afterEach(() => configureOriginalKeeper(null))

// The setting used to live inside convertAudio, so it only ever governed a rewrite onto
// the same path. A format change leaves the old-extension file behind and drops it
// through removeRenamedOriginal — a different path entirely, which kept archiving the
// original however the setting was set.
describe('a format change under the backup policy', () => {
  it('keeps the old-format original under always', async () => {
    const { input, output } = pair()
    const kept = install('always')
    await removeRenamedOriginal(input, output)
    expect(kept).toEqual([input])
  })

  // What the user asked for on 21/09/2026: "Never" has to mean never, whichever write
  // path the conversion happens to take. Since 31/10/2026 only once the self-check has
  // answered: until then the old-format file is held, so a conversion that does not add
  // up still has its original.
  it('holds it under never until the self-check answers', async () => {
    const { input, output } = pair()
    const kept = install('never')
    await removeRenamedOriginal(input, output)
    expect(kept).toEqual([input])
  })

  // Through the real store: once the self-check says the new file adds up, nothing of the
  // original is left, neither on its path nor in Copias.
  it('leaves nothing under never once the self-check says everything matches', async () => {
    const { input, output } = pair()
    const store = createSurcoTrash(mkdtempSync(join(tmpdir(), 'surco-allpaths-trash-')))
    configureBackupStore(store, () => 'never')
    await removeRenamedOriginal(input, output)
    expect(existsSync(input)).toBe(false)
    const [held] = await store.list()
    expect(held.originalPath).toBe(input)
    settleHeldOriginal(claimHeldOriginal(output), 'ok')
    await vi.waitFor(async () => expect(await store.list()).toEqual([]))
    expect(existsSync(held.storedPath)).toBe(false)
  })

  // A format change re-encodes by definition, so the middle level has no reason to skip
  // it: the .wav cannot be reconstructed from the .flac that replaced it.
  it('keeps it under audioChanges, since changing format re-encodes', async () => {
    const { input, output } = pair()
    const kept = install('audioChanges')
    await removeRenamedOriginal(input, output)
    expect(kept).toEqual([input])
  })
})
