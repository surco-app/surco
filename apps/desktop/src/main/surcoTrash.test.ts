import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSurcoTrash, type SurcoTrash } from './surcoTrash'

const DAY = 24 * 60 * 60 * 1000

let root: string
let music: string
let trash: SurcoTrash

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'surco-trash-'))
  music = join(root, 'music')
  mkdirSync(music)
  trash = createSurcoTrash(join(root, 'trash'), { retentionDays: 30, maxBytes: 1000 })
})

function song(name: string, bytes = 100): string {
  const p = join(music, name)
  writeFileSync(p, Buffer.alloc(bytes, 0x41))
  return p
}

// "Replace the original" is the one action Surco takes that cannot be undone: the
// converted file lands on the source's own path and the source is gone. Every defect in
// the write path — four in one week — costs the user the file rather than a redo. The
// trash keeps what was replaced for a while, so a bad write is a restore, not a loss.
describe('stashing a replaced original', () => {
  it('moves the file out of the way and records where it came from', async () => {
    const original = song('Track.aiff')
    const entry = await trash.stash(original, 'replaced', join(music, 'Track.aiff'))
    expect(entry).not.toBeNull()
    expect(existsSync(original)).toBe(false)
    expect(existsSync(entry?.storedPath as string)).toBe(true)
    expect(entry).toMatchObject({
      name: 'Track.aiff',
      originalPath: original,
      bytes: 100,
      reason: 'replaced',
    })
    expect((await trash.list()).map((e) => e.id)).toEqual([entry?.id])
  })

  it('answers null for a file that is not there, rather than inventing an entry', async () => {
    expect(await trash.stash(join(music, 'gone.wav'), 'deleted')).toBeNull()
    expect(await trash.list()).toEqual([])
  })

  it('keeps two originals with the same name apart', async () => {
    const a = await trash.stash(song('Same.wav'), 'deleted')
    const b = await trash.stash(song('Same.wav'), 'deleted')
    expect(a?.storedPath).not.toBe(b?.storedPath)
    expect(readFileSync(a?.storedPath as string).length).toBe(100)
    expect(readFileSync(b?.storedPath as string).length).toBe(100)
  })
})

describe('restoring', () => {
  it('puts the file back where it was', async () => {
    const original = song('Track.aiff')
    const entry = await trash.stash(original, 'replaced')
    const result = await trash.restore(entry?.id as string)
    expect(result.restoredTo).toBe(original)
    expect(readFileSync(original).length).toBe(100)
    expect(await trash.list()).toEqual([])
  })

  // The converted file now sits on the original's path. Restoring must not destroy it
  // either: it takes the original's place in the trash, so the user can go back and
  // forth without ever losing a version.
  it('moves whatever now occupies the path into the trash instead of overwriting it', async () => {
    const original = song('Track.aiff', 100)
    const entry = await trash.stash(original, 'replaced')
    writeFileSync(original, Buffer.alloc(50, 0x42))
    const result = await trash.restore(entry?.id as string)
    expect(readFileSync(original).length).toBe(100)
    expect(result.displaced?.reason).toBe('restored-over')
    expect(result.displaced?.bytes).toBe(50)
    const left = await trash.list()
    expect(left.map((e) => e.reason)).toEqual(['restored-over'])
  })

  it('recreates a folder the user has deleted since', async () => {
    const original = song('Track.aiff')
    const entry = await trash.stash(original, 'replaced')
    const { rmSync } = await import('node:fs')
    rmSync(music, { recursive: true })
    await trash.restore(entry?.id as string)
    expect(existsSync(original)).toBe(true)
  })

  it('rejects an id it does not know', async () => {
    await expect(trash.restore('nope')).rejects.toThrow()
  })
})

describe('removing and emptying', () => {
  it('deletes one entry for good', async () => {
    const entry = await trash.stash(song('A.wav'), 'deleted')
    await trash.remove(entry?.id as string)
    expect(existsSync(entry?.storedPath as string)).toBe(false)
    expect(await trash.list()).toEqual([])
  })

  it('empties everything', async () => {
    await trash.stash(song('A.wav'), 'deleted')
    await trash.stash(song('B.wav'), 'deleted')
    await trash.empty()
    expect(await trash.list()).toEqual([])
  })
})

// A DJ replacing a whole crate of AIFFs would fill a disk if the trash kept everything
// forever, so it keeps what is recent and what fits: entries older than the retention
// go, and past the size cap the oldest go first until it fits.
describe('sweeping', () => {
  it('drops entries older than the retention', async () => {
    const now = Date.now()
    const old = await trash.stash(song('Old.wav'), 'deleted', undefined, now - 31 * DAY)
    const fresh = await trash.stash(song('Fresh.wav'), 'deleted', undefined, now - 1 * DAY)
    const swept = await trash.sweep(now)
    expect(swept.map((e) => e.id)).toEqual([old?.id])
    expect((await trash.list()).map((e) => e.id)).toEqual([fresh?.id])
    expect(existsSync(old?.storedPath as string)).toBe(false)
  })

  it('drops the oldest entries until the total fits under the cap', async () => {
    const now = Date.now()
    const first = await trash.stash(song('1.wav', 600), 'deleted', undefined, now - 3 * DAY)
    const second = await trash.stash(song('2.wav', 600), 'deleted', undefined, now - 2 * DAY)
    const third = await trash.stash(song('3.wav', 300), 'deleted', undefined, now - 1 * DAY)
    const swept = await trash.sweep(now)
    expect(swept.map((e) => e.id)).toEqual([first?.id])
    expect((await trash.list()).map((e) => e.id)).toEqual([third?.id, second?.id])
  })

  it('survives a stored file that vanished under it', async () => {
    const entry = await trash.stash(song('A.wav'), 'deleted', undefined, Date.now() - 40 * DAY)
    const { rmSync } = await import('node:fs')
    rmSync(entry?.storedPath as string)
    await expect(trash.sweep()).resolves.toHaveLength(1)
    expect(await trash.list()).toEqual([])
  })
})

describe('the manifest', () => {
  it('lists newest first and survives a reload from disk', async () => {
    await trash.stash(song('A.wav'), 'deleted', undefined, 1000)
    await trash.stash(song('B.wav'), 'deleted', undefined, 2000)
    const reopened = createSurcoTrash(join(root, 'trash'))
    expect((await reopened.list()).map((e) => e.name)).toEqual(['B.wav', 'A.wav'])
  })

  it('treats a corrupt manifest as empty rather than failing every call', async () => {
    mkdirSync(join(root, 'trash'), { recursive: true })
    writeFileSync(join(root, 'trash', 'trash.json'), '{not json')
    const t = createSurcoTrash(join(root, 'trash'))
    expect(await t.list()).toEqual([])
    expect(statSync(join(root, 'trash')).isDirectory()).toBe(true)
  })
})
