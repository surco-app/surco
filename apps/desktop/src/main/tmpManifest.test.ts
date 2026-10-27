import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTmpManifest } from './tmpManifest'

// What node's fs throws for a file that is not there — the one delete failure that
// means the sweep is done with that path rather than blocked on it.
const enoent = (): NodeJS.ErrnoException =>
  Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })

function fakeFs(initial: string[] = []): {
  readFileSync: (p: string) => string
  writeFileSync: (p: string, data: string) => void
  existsSync: (p: string) => boolean
  unlink: (p: string) => Promise<void>
  pathExists: (p: string) => Promise<boolean>
  written: () => string[]
  removed: string[]
} {
  let contents = JSON.stringify(initial)
  let exists = true
  const removed: string[] = []
  return {
    readFileSync: () => contents,
    writeFileSync: (_p, data) => {
      contents = data
      exists = true
    },
    existsSync: () => exists,
    unlink: async (p) => {
      removed.push(p)
    },
    pathExists: async () => true,
    written: () => JSON.parse(contents),
    removed,
  }
}

describe('createTmpManifest', () => {
  // convertAudio's temp file lives beside the user's own output — anywhere on
  // disk, in-place edits included — so a crash or force-quit mid-write leaves it
  // there forever with no OS tmpdir purge to eventually clean it up. This is the
  // record that lets the next launch find and remove exactly that file, nothing
  // else nearby.
  it('persists a tracked path to disk and removes it once untracked', () => {
    const fs = fakeFs()
    const manifest = createTmpManifest('/manifest.json', fs)
    manifest.track('/out/Song.tmp-a1b2c3d4.aiff')
    expect(fs.written()).toEqual(['/out/Song.tmp-a1b2c3d4.aiff'])
    manifest.untrack('/out/Song.tmp-a1b2c3d4.aiff')
    expect(fs.written()).toEqual([])
  })

  it('tracks several in-flight conversions independently', () => {
    const fs = fakeFs()
    const manifest = createTmpManifest('/manifest.json', fs)
    manifest.track('/a.tmp-1.aiff')
    manifest.track('/b.tmp-2.aiff')
    manifest.untrack('/a.tmp-1.aiff')
    expect(fs.written()).toEqual(['/b.tmp-2.aiff'])
  })

  // Never a glob over the user's folders — only the exact paths this app itself
  // wrote to the manifest ever get deleted.
  it('sweeps every path left over from a previous run and clears the manifest', async () => {
    const fs = fakeFs(['/out/Song.tmp-a1b2c3d4.aiff', '/music/Track.tmp-deadbeef.flac'])
    const manifest = createTmpManifest('/manifest.json', fs)
    await manifest.sweepOrphans()
    expect(fs.removed).toEqual(['/out/Song.tmp-a1b2c3d4.aiff', '/music/Track.tmp-deadbeef.flac'])
    expect(fs.written()).toEqual([])
  })

  it('does nothing when no manifest file exists yet (fresh install, or already swept)', async () => {
    const fs = fakeFs()
    fs.existsSync = () => false
    const manifest = createTmpManifest('/manifest.json', fs)
    await expect(manifest.sweepOrphans()).resolves.toBeUndefined()
    expect(fs.removed).toEqual([])
  })

  // A file already gone (removed by the user, or the crash happened before ffmpeg
  // even created it) must not stop the rest of the sweep.
  it('tolerates a listed path that no longer exists', async () => {
    const fs = fakeFs(['/gone.tmp-1.aiff', '/still-there.tmp-2.aiff'])
    fs.unlink = vi.fn(async (p: string) => {
      if (p === '/gone.tmp-1.aiff') throw enoent()
      fs.removed.push(p)
    })
    const manifest = createTmpManifest('/manifest.json', fs)
    await expect(manifest.sweepOrphans()).resolves.toBeUndefined()
    expect(fs.removed).toEqual(['/still-there.tmp-2.aiff'])
    // Gone means gone: nothing left to sweep, so the manifest empties.
    expect(fs.written()).toEqual([])
  })

  // A delete that fails for any reason other than "already gone" leaves the file on
  // disk — a network volume still holding the handle, or a Windows scanner. Clearing
  // the manifest anyway destroyed the only record of it, which is what left orphaned
  // temps parked in the user's music folder with nothing able to find them again.
  // convertAudio takes the same care one layer down (its catch keeps the path listed
  // when the unlink survives), and this line used to undo it at the next launch.
  it('keeps a path it could not delete listed for the next sweep', async () => {
    const fs = fakeFs(['/held.tmp-1.aiff', '/gone.tmp-2.aiff', '/removed.tmp-3.aiff'])
    fs.unlink = vi.fn(async (p: string) => {
      if (p === '/held.tmp-1.aiff')
        throw Object.assign(new Error('EBUSY: resource busy'), {
          code: 'EBUSY',
        })
      if (p === '/gone.tmp-2.aiff') throw enoent()
      fs.removed.push(p)
    })
    const manifest = createTmpManifest('/manifest.json', fs)

    await manifest.sweepOrphans()

    expect(fs.removed).toEqual(['/removed.tmp-3.aiff'])
    // Only the survivor stays: the deleted one is gone and the never-there one would
    // send every future sweep chasing a path that does not exist.
    expect(fs.written()).toEqual(['/held.tmp-1.aiff'])
  })

  // Windows raises EPERM rather than EBUSY when an antivirus holds the file — the same
  // situation, and the reason the retained-path rule is keyed on "not ENOENT" instead
  // of on one platform's code.
  it('keeps a path held under the Windows permission error too', async () => {
    const fs = fakeFs(['/scanned.tmp-1.aiff'])
    fs.unlink = vi.fn(async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    })
    const manifest = createTmpManifest('/manifest.json', fs)

    await manifest.sweepOrphans()

    expect(fs.written()).toEqual(['/scanned.tmp-1.aiff'])
  })

  // A NAS or external disk that is not mounted yet when Surco launches (the app opens at
  // login, the share mounts later) answers ENOENT for every path under it, exactly like
  // a file that is gone. Taken at its word, the sweep dropped those entries for good and
  // the temps stayed in the user's share, 21 MB each, with nothing left to find them.
  it('keeps a path whose folder is not there, since its volume may just be unmounted', async () => {
    const fs = fakeFs(['/Volumes/NAS/Music/.Song.tmp-1.mp3', '/music/.gone.tmp-2.mp3'])
    fs.pathExists = async (p: string) => p !== '/Volumes/NAS/Music'
    fs.unlink = vi.fn(async () => {
      throw enoent()
    })
    const manifest = createTmpManifest('/manifest.json', fs)

    await manifest.sweepOrphans()

    expect(fs.written()).toEqual(['/Volumes/NAS/Music/.Song.tmp-1.mp3'])
  })

  // The sweep used to unlink synchronously before the window existed, so a stale NAS mount
  // froze the launch on a black screen. It now runs in the background once the window is
  // up, which means a conversion can start and track its own temp mid-sweep: that entry
  // must survive the sweep's final write, or a crash would orphan it.
  it('keeps a temp tracked while the sweep is still deleting', async () => {
    const fs = fakeFs(['/Volumes/NAS/old.tmp-1.aiff'])
    let finishUnlink: () => void = () => undefined
    fs.unlink = vi.fn(
      (p: string) =>
        new Promise<void>((resolve) => {
          finishUnlink = () => {
            fs.removed.push(p)
            resolve()
          }
        }),
    )
    const manifest = createTmpManifest('/manifest.json', fs)

    const sweeping = manifest.sweepOrphans()
    manifest.track('/out/new.tmp-2.aiff')
    finishUnlink()
    await sweeping

    expect(fs.removed).toEqual(['/Volumes/NAS/old.tmp-1.aiff'])
    expect(fs.written()).toEqual(['/out/new.tmp-2.aiff'])
  })

  it('tolerates a corrupt manifest file, sweeping nothing instead of throwing', async () => {
    const fs = fakeFs()
    fs.readFileSync = () => '{not json'
    const manifest = createTmpManifest('/manifest.json', fs)
    await expect(manifest.sweepOrphans()).resolves.toBeUndefined()
  })
})

describe('a second launch while Surco is running', () => {
  it('exits before the launch sweep can delete the temps the first instance is writing', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const lock = source.indexOf('if (!app.requestSingleInstanceLock()) app.exit(0)')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(source.indexOf('tmpManifest.sweepOrphans()'))
    expect(source).toContain("app.on('second-instance'")
  })
})
