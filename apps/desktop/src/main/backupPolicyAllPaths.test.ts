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
import { configureOriginalKeeper, policyKeeper } from './originalKeeper'

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
  // path the conversion happens to take.
  it('deletes it outright under never, keeping nothing', async () => {
    const { input, output } = pair()
    const kept = install('never')
    await removeRenamedOriginal(input, output)
    expect(kept).toEqual([])
    // Not kept AND not left behind: the file the user replaced is gone, which is the
    // whole point of the level and why Settings warns before it is chosen.
    expect(existsSync(input)).toBe(false)
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
