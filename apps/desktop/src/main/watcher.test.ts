import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dirRoots, FolderWatcher } from './watcher'

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
        expect(
          onChange.mock.calls.some(([, files]) => files.includes(join(dir, 'new.flac'))),
        ).toBe(true),
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
