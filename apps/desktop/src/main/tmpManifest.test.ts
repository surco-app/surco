import { describe, expect, it, vi } from 'vitest'
import { createTmpManifest } from './tmpManifest'

function fakeFs(initial: string[] = []): {
  readFileSync: (p: string) => string
  writeFileSync: (p: string, data: string) => void
  existsSync: (p: string) => boolean
  unlinkSync: (p: string) => void
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
    unlinkSync: (p) => removed.push(p),
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
  it('sweeps every path left over from a previous run and clears the manifest', () => {
    const fs = fakeFs(['/out/Song.tmp-a1b2c3d4.aiff', '/music/Track.tmp-deadbeef.flac'])
    const manifest = createTmpManifest('/manifest.json', fs)
    manifest.sweepOrphans()
    expect(fs.removed).toEqual(['/out/Song.tmp-a1b2c3d4.aiff', '/music/Track.tmp-deadbeef.flac'])
    expect(fs.written()).toEqual([])
  })

  it('does nothing when no manifest file exists yet (fresh install, or already swept)', () => {
    const fs = fakeFs()
    fs.existsSync = () => false
    const manifest = createTmpManifest('/manifest.json', fs)
    expect(() => manifest.sweepOrphans()).not.toThrow()
    expect(fs.removed).toEqual([])
  })

  // A file already gone (removed by the user, or the crash happened before ffmpeg
  // even created it) must not stop the rest of the sweep.
  it('tolerates a listed path that no longer exists', () => {
    const fs = fakeFs(['/gone.tmp-1.aiff', '/still-there.tmp-2.aiff'])
    fs.unlinkSync = vi.fn((p: string) => {
      if (p === '/gone.tmp-1.aiff') throw new Error('ENOENT')
      fs.removed.push(p)
    })
    const manifest = createTmpManifest('/manifest.json', fs)
    expect(() => manifest.sweepOrphans()).not.toThrow()
    expect(fs.removed).toEqual(['/still-there.tmp-2.aiff'])
  })

  it('tolerates a corrupt manifest file, sweeping nothing instead of throwing', () => {
    const fs = fakeFs()
    fs.readFileSync = () => '{not json'
    const manifest = createTmpManifest('/manifest.json', fs)
    expect(() => manifest.sweepOrphans()).not.toThrow()
  })
})
