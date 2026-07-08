import { afterAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

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
  it('round-trips the saved paths, dropping files that no longer exist', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept, join(dir, 'gone.wav')], {})
    expect(loadLastSession().paths).toEqual([kept])
  })

  // The user feedback behind the edits field: hundreds of tracks re-tagged but not yet
  // converted, then the machine froze — every staged edit gone. The edits must survive
  // the round-trip so a relaunch can restore them onto the reopened session.
  it('round-trips staged edits keyed by path', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    const staged = edit({ outputName: 'A1 - Edited', matched: true, matchConfidence: 0.9 })
    saveLastSession([kept], { [kept]: staged })
    expect(loadLastSession().edits).toEqual({ [kept]: staged })
  })

  // An edit whose track dropped out of the offer (file gone) has nothing to restore
  // onto; keeping it would only grow the file forever.
  it('drops edits for paths that no longer exist', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    const gone = join(dir, 'gone.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept, gone], { [kept]: edit(), [gone]: edit() })
    expect(Object.keys(loadLastSession().edits)).toEqual([kept])
  })

  // Pasted covers live in an OS temp dir that a reboot clears; a vanished cover file
  // can't be embedded, so the restored track must fall back to its own artwork rather
  // than carry a path the conversion would fail on.
  it('drops a cover path whose file no longer exists', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    saveLastSession([kept], {
      [kept]: edit({ coverPath: join(dir, 'gone-cover.png') }),
    })
    expect(loadLastSession().edits[kept].coverPath).toBeUndefined()
  })

  // A locally picked cover was displayed through a blob: URL that died with the old
  // renderer, so only its file path survives. Minting a fresh data: preview at load
  // keeps the restored row showing the exact cover it will embed.
  it('mints a preview for a surviving cover file that lost its display URL', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    const cover = join(dir, 'cover.png')
    writeFileSync(kept, 'x')
    writeFileSync(cover, 'img')
    saveLastSession([kept], { [kept]: edit({ coverPath: cover }) })
    const restored = loadLastSession().edits[kept]
    expect(restored.coverPath).toBe(cover)
    expect(restored.coverUrl).toContain(`data:image/png;base64,preview:${cover}`)
  })

  // Clearing the list is a deliberate start-over; the next launch must not offer the
  // session the user just emptied.
  it('persists an emptied session', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    saveLastSession([kept], {})
    saveLastSession([], {})
    expect(loadLastSession()).toEqual({ paths: [], edits: {} })
  })

  // A corrupt or hand-edited file must degrade to "no previous session", never crash
  // the launch path that reads it.
  it('treats a corrupt or malformed session file as empty', () => {
    const file = join(app.getPath('userData'), 'session.json')
    writeFileSync(file, '{not json')
    expect(loadLastSession()).toEqual({ paths: [], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: 'nope' }))
    expect(loadLastSession()).toEqual({ paths: [], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [1, 2] }))
    expect(loadLastSession()).toEqual({ paths: [], edits: {} })
  })

  // A session saved by a version without edits (or with a mangled edits value) still
  // reopens its paths; malformed entries degrade to "no staged edits" per track.
  it('tolerates missing or malformed edits', () => {
    const dir = app.getPath('userData')
    const kept = join(dir, 'kept.wav')
    writeFileSync(kept, 'x')
    const file = join(dir, 'session.json')
    writeFileSync(file, JSON.stringify({ paths: [kept] }))
    expect(loadLastSession()).toEqual({ paths: [kept], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [kept], edits: 'nope' }))
    expect(loadLastSession()).toEqual({ paths: [kept], edits: {} })
    writeFileSync(file, JSON.stringify({ paths: [kept], edits: { [kept]: { meta: 'nope' } } }))
    expect(loadLastSession()).toEqual({ paths: [kept], edits: {} })
  })
})
