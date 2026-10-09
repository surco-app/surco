import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupPolicy } from '../shared/backupPolicy'
import type { TrashReason } from '../shared/types'
import {
  configureBackupDiscarder,
  configureBackupStore,
  configureOriginalKeeper,
  discardBackup,
  keepOriginal,
  policyKeeper,
} from './originalKeeper'

afterEach(() => {
  configureOriginalKeeper(null)
  configureBackupDiscarder(null)
})

// Every write path that can cost the user a file goes through keepOriginal, so the
// setting belongs on that seam rather than at each call site. When it lived only inside
// convertAudio, "Never" still archived the original of a format change (the 'renamed'
// path in inplace.ts) and of a delete on a NAS — the setting said one thing and two of
// the three paths did another.
describe('policyKeeper', () => {
  function keeperFor(policy: BackupPolicy) {
    const stashed: { path: string; reason: string }[] = []
    const keeper = policyKeeper(
      () => policy,
      async (path, reason) => {
        stashed.push({ path, reason })
        return null
      },
    )
    return { keeper, stashed }
  }

  it('keeps every path under always', async () => {
    const { keeper, stashed } = keeperFor('always')
    await keeper('/a.aiff', 'replaced', '/a.aiff', { reencodes: false })
    await keeper('/b.wav', 'renamed', '/b.flac', { reencodes: true })
    await keeper('/c.wav', 'deleted')
    expect(stashed.map((s) => s.reason)).toEqual(['replaced', 'renamed', 'deleted'])
  })

  it('keeps nothing at all under never, the NAS delete included', async () => {
    const { keeper, stashed } = keeperFor('never')
    await keeper('/a.aiff', 'replaced', '/a.aiff', { reencodes: true })
    await keeper('/b.wav', 'renamed', '/b.flac', { reencodes: true })
    // A delete on a volume with no OS Trash has no other net: under 'never' it becomes
    // permanent, which the settings warning states before the user picks it.
    await keeper('/c.wav', 'deleted')
    expect(stashed).toEqual([])
  })

  // The middle level is about re-rendered audio, so it only has an opinion where a
  // conversion happened. A format change re-encodes by definition, and a delete has no
  // conversion to judge — treating either as "audio unchanged" would silently drop the
  // one copy standing between the user and a lost file.
  it('under audioChanges, skips only a rewrite that copied the audio through', async () => {
    const { keeper, stashed } = keeperFor('audioChanges')
    await keeper('/tags.aiff', 'replaced', '/tags.aiff', { reencodes: false })
    await keeper('/conv.aiff', 'replaced', '/conv.aiff', { reencodes: true })
    await keeper('/fmt.wav', 'renamed', '/fmt.flac')
    await keeper('/nas.wav', 'deleted')
    expect(stashed.map((s) => s.path)).toEqual(['/conv.aiff', '/fmt.wav', '/nas.wav'])
  })

  // The policy is read per call, not captured when the keeper is built: Settings is
  // saved while the app runs, and a keeper installed at launch would honour the value
  // the app started with until the next restart.
  it('reads the policy at each call', async () => {
    let policy: BackupPolicy = 'always'
    const stashed: string[] = []
    const keeper = policyKeeper(
      () => policy,
      async (path) => {
        stashed.push(path)
        return null
      },
    )
    await keeper('/before.aiff', 'replaced', '/before.aiff', { reencodes: true })
    policy = 'never'
    await keeper('/after.aiff', 'replaced', '/after.aiff', { reencodes: true })
    expect(stashed).toEqual(['/before.aiff'])
  })
})

describe('keepOriginal', () => {
  // Unconfigured — every unit test that drives a conversion — it keeps nothing and the
  // callers fall back to what they did before: rename over, unlink.
  it('keeps nothing while no keeper is installed', async () => {
    expect(await keepOriginal('/a.aiff', 'replaced')).toBeNull()
  })

  it('passes the conversion verdict through to the installed keeper', async () => {
    const keeper = vi.fn(async () => null)
    configureOriginalKeeper(keeper)
    await keepOriginal('/a.aiff', 'replaced', '/a.aiff', { reencodes: false })
    expect(keeper).toHaveBeenCalledWith('/a.aiff', 'replaced', '/a.aiff', { reencodes: false })
  })
})

// The setting sat dead from v0.99.8 to v1.7.0: policyKeeper existed and was tested, but
// launch installed the bare store, so every level kept a copy of everything.
describe('configureBackupStore', () => {
  function store() {
    return {
      stash: vi.fn(async (path: string, reason: TrashReason) => ({
        id: 'kept',
        name: 'x',
        originalPath: path,
        storedPath: '',
        bytes: 0,
        trashedAt: 0,
        reason,
      })),
      remove: vi.fn(async (_id: string) => {}),
    }
  }

  it('keeps nothing from a conversion under never', async () => {
    const s = store()
    configureBackupStore(s, () => 'never')
    expect(await keepOriginal('/a.aiff', 'replaced', '/a.aiff', { reencodes: true })).toBeNull()
    expect(await keepOriginal('/b.wav', 'renamed', '/b.flac')).toBeNull()
    expect(s.stash).not.toHaveBeenCalled()
  })

  it('skips a tag-only update but keeps a re-encode under audioChanges', async () => {
    const s = store()
    configureBackupStore(s, () => 'audioChanges')
    expect(await keepOriginal('/a.aiff', 'replaced', '/a.aiff', { reencodes: false })).toBeNull()
    expect(await keepOriginal('/b.aiff', 'replaced', '/b.aiff', { reencodes: true })).not.toBeNull()
    expect(s.stash.mock.calls.map(([path]) => path)).toEqual(['/b.aiff'])
  })

  it('keeps a tag-only update under always', async () => {
    const s = store()
    configureBackupStore(s, () => 'always')
    expect(
      await keepOriginal('/a.aiff', 'replaced', '/a.aiff', { reencodes: false }),
    ).not.toBeNull()
  })

  it('discards a backup through the same store', async () => {
    const s = store()
    configureBackupStore(s, () => 'always')
    const entry = await keepOriginal('/a.aiff', 'replaced', '/a.aiff', { reencodes: true })
    if (!entry) throw new Error('expected a backup')
    await discardBackup(entry)
    expect(s.remove).toHaveBeenCalledWith('kept')
  })
})

// The bug itself lived in index.ts, which no unit test can import: launch called
// configureOriginalKeeper with the bare store. Read the source so it cannot come back.
describe('launch', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')

  it('installs the store behind the live backup setting', () => {
    expect(source).toContain('configureBackupStore(surcoTrash, () => getSettings().backupPolicy)')
  })

  it('never installs a keeper that skips the setting', () => {
    expect(source).not.toContain('configureOriginalKeeper(')
  })
})
