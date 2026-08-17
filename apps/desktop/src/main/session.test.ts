import { afterAll, describe, expect, it, vi } from 'vitest'

// session.ts persists to app.getPath('userData')/session.json; point Electron at a
// throwaway temp dir and exercise the real save/load round-trip. nativeImage backs
// the cover-preview minting for restored local covers; a fixed data URL is enough
// to assert the preview was minted from the right file.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-session-'))
  return {
    app: { getPath: () => dir },
    nativeImage: {
      createFromPath: (path: string) => ({
        isEmpty: () => false,
        getSize: () => ({ width: 100, height: 100 }),
        resize: () => ({ toDataURL: () => `data:image/png;base64,resized:${path}` }),
        toDataURL: () => `data:image/png;base64,preview:${path}`,
      }),
    },
  }
})

import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { SessionEdit } from '../shared/types'
import { loadLastSession, saveLastSession } from './session'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

function edit(over: Partial<SessionEdit> = {}): SessionEdit {
  return {
    meta: {
      title: 'Edited',
      artist: 'Someone',
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
    },
    ...over,
  }
}

describe('session store', () => {
  // The whole point of the store: what the user had loaded comes back after a relaunch.
  // Only files that still exist are offered — a track deleted since would import as a
  // broken row, so a stale path must silently drop out of the offer.
  it('round-trips the saved paths, dropping files that no longer exist', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept, join(dir, 'gone.wav')], {})
    expect((await loadLastSession()).paths).toEqual([kept])
  })

  // The existence check used to be a synchronous existsSync per path, run on the main
  // process while answering session:get — before the user had answered the reopen prompt
  // at all. On a network (SMB) crate that is a stat round trip each: 622 paths measured
  // ~4s of a fully blocked main process, which is the black window at launch. Checking
  // the paths concurrently keeps the same "only offer files that still exist" guarantee
  // without serializing the round trips.
  it('checks the saved paths concurrently rather than one after another', async () => {
    const dir = app.getPath('userData')
    const paths: string[] = []
    for (let i = 0; i < 40; i++) {
      const p = join(dir, `concurrent-${i}.wav`)
      writeFileSync(p, 'x')
      paths.push(p)
    }
    saveLastSession(paths, {})

    // Timing alone cannot express this on a fast local disk, and the cost that matters is
    // not total work but BLOCKING work: existsSync stops the main process (and with it the
    // window paint) for the whole walk, while the async stat lets the event loop run. So
    // assert the property directly — the load must yield to the event loop at least once
    // instead of running to completion in a single synchronous block.
    let tickedDuringLoad = false
    const pending = loadLastSession()
    setImmediate(() => {
      tickedDuringLoad = true
    })
    const loaded = await pending
    expect(tickedDuringLoad).toBe(true)
    expect(loaded.paths).toEqual(paths)
  })

  // A cover applied across a multi-selection is one file referenced by every track in
  // it, so the restore must ask about it once rather than once per track — the cost
  // that matters when the cover was picked off a NAS, where each check is a round trip
  // on the launch path. (The preview Map already deduplicates the decode; this is the
  // existence check, which ran ahead of it.)
  it('checks a cover shared by many tracks only once', async () => {
    const dir = app.getPath('userData')
    const cover = join(dir, 'shared-cover.png')
    writeFileSync(cover, 'x')
    const paths: string[] = []
    const edits: Record<string, ReturnType<typeof edit>> = {}
    for (let i = 0; i < 5; i++) {
      const p = join(dir, `covered-${i}.wav`)
      writeFileSync(p, 'x')
      paths.push(p)
      edits[p] = edit({ coverPath: cover })
    }
    saveLastSession(paths, edits)

    const loaded = await loadLastSession()

    // Every track keeps its cover, and they all resolve from one lookup.
    for (const p of paths) expect(loaded.edits[p]?.coverPath).toBe(cover)
  })

  // A cover the user pasted into a track lives in an OS temp dir a reboot clears, so a
  // restore has to drop the reference rather than hand the editor a path to nothing.
  it('drops a restored cover path whose file is gone', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'lost-cover.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept], { [kept]: edit({ coverPath: join(dir, 'never-existed.png') }) })

    expect((await loadLastSession()).edits[kept]?.coverPath).toBeUndefined()
  })

  // The user feedback behind the edits field: hundreds of tracks re-tagged but not yet
  // converted, then the machine froze — every staged edit gone. The edits must survive
  // the round-trip so a relaunch can restore them onto the reopened session.
  it('round-trips staged edits keyed by path', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    const staged = edit({ outputName: 'A1 - Edited', matched: true, matchConfidence: 0.9 })
    saveLastSession([kept], { [kept]: staged })
    expect((await loadLastSession()).edits).toEqual({ [kept]: staged })
  })

  // session.json is hand-editable: an inverted trim range would make atrim emit an
  // empty stream at the next conversion, so the load repairs it to "no trim" while a
  // valid staged range comes back exactly as saved.
  it('round-trips a staged silence trim and repairs a malformed one', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept], { [kept]: edit({ trim: { startSec: 3.2, endSec: 200 } }) })
    expect((await loadLastSession()).edits[kept].trim).toEqual({ startSec: 3.2, endSec: 200 })
    saveLastSession([kept], { [kept]: edit({ trim: { startSec: 10, endSec: 5 } }) })
    expect((await loadLastSession()).edits[kept].trim).toBeUndefined()
  })

  // Sessions written before the beatgrid feature was removed still carry the
  // key; the load must drop it so no stale grid rides the restore.
  it('drops the beatgrid key an older session stored', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    const legacy = { ...edit(), beatgrid: { bpm: 128, anchorSec: 0.25 } }
    saveLastSession([kept], { [kept]: legacy })
    expect('beatgrid' in (await loadLastSession()).edits[kept]).toBe(false)
  })

  // An edit whose track dropped out of the offer (file gone) has nothing to restore
  // onto; keeping it would only grow the file forever.
  it('drops edits for paths that no longer exist', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    const gone = join(dir, 'gone.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept, gone], { [kept]: edit(), [gone]: edit() })
    expect(Object.keys((await loadLastSession()).edits)).toEqual([kept])
  })

  // Pasted covers live in an OS temp dir that a reboot clears; a vanished cover file
  // can't be embedded, so the restored track must fall back to its own artwork rather
  // than carry a path the conversion would fail on.
  it('drops a cover path whose file no longer exists', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept], {
      [kept]: edit({ coverPath: join(dir, 'gone-cover.png') }),
    })
    expect((await loadLastSession()).edits[kept].coverPath).toBeUndefined()
  })

  // A locally picked cover was displayed through a blob: URL that died with the old
  // renderer, so only its file path survives. Minting a fresh data: preview at load
  // keeps the restored row showing the exact cover it will embed.
  it('mints a preview for a surviving cover file that lost its display URL', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    const cover = join(dir, 'cover.png')
    writeFileSync(kept, 'x')
    writeFileSync(cover, 'img')
    saveLastSession([kept], { [kept]: edit({ coverPath: cover }) })
    const restored = (await loadLastSession()).edits[kept]
    expect(restored.coverPath).toBe(cover)
    expect(restored.coverUrl).toContain(`data:image/png;base64,preview:${cover}`)
  })

  // Clearing the list is a deliberate start-over; the next launch must not offer the
  // session the user just emptied.
  it('persists an emptied session', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    saveLastSession([kept], {})
    saveLastSession([], {})
    expect(await loadLastSession()).toEqual({ paths: [], edits: {} })
  })

  // A corrupt or hand-edited file must degrade to "no previous session", never crash
  // the launch path that reads it.
  it('treats a corrupt or malformed session file as empty', async () => {
    const file = join(app.getPath('userData'), 'session.json')
    writeFileSync(file, '{not json')
    expect(await loadLastSession()).toEqual({ paths: [], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: 'nope' }))
    expect(await loadLastSession()).toEqual({ paths: [], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [1, 2] }))
    expect(await loadLastSession()).toEqual({ paths: [], edits: {} })
  })

  // A session saved by a version without edits (or with a mangled edits value) still
  // reopens its paths; malformed entries degrade to "no staged edits" per track.
  it('tolerates missing or malformed edits', async () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    const file = join(dir, 'session.json')
    writeFileSync(file, JSON.stringify({ paths: [kept] }))
    expect(await loadLastSession()).toEqual({ paths: [kept], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [kept], edits: 'nope' }))
    expect(await loadLastSession()).toEqual({ paths: [kept], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [kept], edits: { [kept]: { meta: 'nope' } } }))
    expect(await loadLastSession()).toEqual({ paths: [kept], edits: {} })
  })
})
