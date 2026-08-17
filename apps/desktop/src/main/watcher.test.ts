import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dirRoots, FolderWatcher, nextPollMs } from './watcher'

describe('dirRoots', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-roots-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps the directories among dropped paths and drops plain files', async () => {
    // A drop mixes files and folders; only the folders are worth watching for
    // late-arriving tracks — a single dropped file has no folder to grow.
    await mkdir(join(dir, 'album'))
    await writeFile(join(dir, 'loose.wav'), '')

    expect(await dirRoots([join(dir, 'album'), join(dir, 'loose.wav')])).toEqual([
      join(dir, 'album'),
    ])
  })

  it('ignores paths that no longer exist instead of throwing', async () => {
    expect(await dirRoots([join(dir, 'gone')])).toEqual([])
  })
})

describe('FolderWatcher', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-watch-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the folder root and its current audio files when a file appears', async () => {
    // The renderer diffs the reported audio list against what it already holds, so the
    // watcher must hand back the folder's full current audio set, not just the new file.
    await writeFile(join(dir, 'old.wav'), '')
    const onChange = vi.fn()
    const watcher = new FolderWatcher(onChange, 50)
    watcher.watch([dir])
    // macOS FSEvents takes a beat to arm; writing too soon races the watch setup.
    await new Promise((r) => setTimeout(r, 300))

    await writeFile(join(dir, 'new.flac'), '')
    // FSEvents also replays the pre-existing file as an arm-time event, so wait for the
    // rescan that actually includes the newly written track, not merely the first fire.
    await vi.waitFor(
      () =>
        expect(onChange.mock.calls.some(([, files]) => files.includes(join(dir, 'new.flac')))).toBe(
          true,
        ),
      { timeout: 4000 },
    )

    const [root, files] = onChange.mock.calls.find(([, f]) =>
      f.includes(join(dir, 'new.flac')),
    ) as [string, string[]]
    expect(root).toBe(dir)
    expect(files.sort()).toEqual([join(dir, 'new.flac'), join(dir, 'old.wav')].sort())
    watcher.close()
  })

  it('re-scans on a poll interval so tracks fs.watch misses still surface', async () => {
    // fs.watch is unreliable on network volumes and for apps that write oddly (Soulseek
    // renames a temp file into place deep in a per-user subfolder); a periodic sweep is the
    // safety net. A static folder fires the OS watch 0–1 times, so seeing onChange more than
    // once over two intervals proves the poll, not the watcher, is driving it.
    await writeFile(join(dir, 'a.wav'), '')
    const onChange = vi.fn()
    const watcher = new FolderWatcher(onChange, 50, 60)
    watcher.watch([dir])

    await vi.waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2000,
    })
    expect((onChange.mock.calls.at(-1) as [string, string[]])[1]).toEqual([join(dir, 'a.wav')])
    watcher.close()
  })

  // The safety-net poll re-walks every watched root, and that walk is one round trip per
  // directory: a real 560-folder crate on an SMB share costs ~20s of them even warm (the
  // measurement in expand.ts). At a flat 60s interval that is a third of every minute
  // spent re-reading a folder that almost never changes, forever. Backing off while
  // nothing turns up keeps the net without the standing cost — and any find, from the
  // poll or the OS watch, drops it straight back to the fast interval.
  describe('poll backoff', () => {
    it('starts at the base interval', () => {
      expect(nextPollMs(0, 60_000)).toBe(60_000)
    })

    it('doubles for each sweep that finds nothing', () => {
      expect(nextPollMs(1, 60_000)).toBe(120_000)
      expect(nextPollMs(2, 60_000)).toBe(240_000)
      expect(nextPollMs(3, 60_000)).toBe(480_000)
    })

    // Ten minutes is the floor of usefulness for the case the poll exists for: a track
    // Soulseek dropped into a watched folder has to surface on its own eventually, and
    // a quiet crate must not drift into never being checked at all.
    it('stops growing at ten minutes', () => {
      expect(nextPollMs(10, 60_000)).toBe(600_000)
      expect(nextPollMs(100, 60_000)).toBe(600_000)
    })

    // A crate being actively filled (a download landing, a USB copy) must stay on the
    // fast interval: the user is watching the list for those rows to appear.
    it('returns to the base interval once something is found', () => {
      expect(nextPollMs(0, 60_000)).toBe(60_000)
    })

    // The interval is a constructor parameter (the tests above run at 60ms, not 60s),
    // so the ceiling has to scale with it rather than being a hardcoded 600_000.
    it('scales the ceiling with the configured interval', () => {
      expect(nextPollMs(100, 60)).toBe(600)
    })
  })

  // The backoff is only safe if a find really does reset it — otherwise a crate that
  // goes quiet for a while would stay slow to notice the next drop. Driven through the
  // real watcher rather than the pure function so the reset is wired, not just correct.
  it('keeps checking at the base rate while files keep appearing', async () => {
    const onChange = vi.fn()
    const watcher = new FolderWatcher(onChange, 50, 40)
    watcher.watch([dir])
    // Two sweeps of an empty folder: enough for the interval to have grown.
    await new Promise((r) => setTimeout(r, 150))
    const beforeFind = onChange.mock.calls.length

    await writeFile(join(dir, 'landed.wav'), '')

    // The find resets the interval, so the reports that follow come at the base rate
    // rather than the backed-off one — several within a window the slow rate could not
    // fill on its own.
    await vi.waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(beforeFind + 1), {
      timeout: 2000,
    })
    watcher.close()
  })

  // folders:unwatch closes the window's watcher but leaves it in the map, so loading the
  // next crate calls watch() on this same closed object. It has to come back to life, or
  // clearing a crate would silently cost auto-detection for the rest of the session.
  it('watches again after a close, for the crate loaded next', async () => {
    const onChange = vi.fn()
    const watcher = new FolderWatcher(onChange, 50, 60)
    watcher.watch([dir])
    watcher.close()

    watcher.watch([dir])
    await writeFile(join(dir, 'second-crate.wav'), '')

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 2000 })
    watcher.close()
  })

  it('stops reporting after close so a torn-down crate goes quiet', async () => {
    const onChange = vi.fn()
    const watcher = new FolderWatcher(onChange, 50, 60)
    watcher.watch([dir])
    watcher.close()

    await writeFile(join(dir, 'late.wav'), '')
    await new Promise((r) => setTimeout(r, 200))
    expect(onChange).not.toHaveBeenCalled()
  })
})
