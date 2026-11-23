import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import log from 'electron-log/main'
import { describe, expect, it, vi } from 'vitest'
import { DJ_PROGRAMS } from '../shared/djProgram'
import type { ReplacedEntry } from '../shared/toReview'
import {
  createReplacedStore,
  followingPrograms,
  followReplaced,
  keepReplacedForReview,
  recordReplacement,
} from './replacedStore'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

async function fileIn(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'surco-replacedstore-')), 'replaced-tracks.json')
}

const entry = (over: Partial<ReplacedEntry> = {}): ReplacedEntry => ({
  newPath: '/m/new.flac',
  oldPath: '/m/old.mp3',
  replacedAt: 1,
  shift: { moved: 0 },
  pending: ['rekordbox', 'traktor'],
  ...over,
})

describe('createReplacedStore', () => {
  it('keeps a replaced track across restarts, so nothing slips out of the list unreviewed', async () => {
    const file = await fileIn()
    createReplacedStore(file).add(entry())
    expect(createReplacedStore(file).list()).toEqual([entry()])
  })

  it('finds the entry by the old path, which a program still shows while its repoint waits in the queue', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    expect(store.review('/m/old.mp3', ['traktor'])?.pending).toEqual(['rekordbox', 'traktor'])
    expect(store.list()[0].pending).toEqual(['rekordbox'])
  })

  // A file can be one track's new copy and another's old one (a later conversion moved it
  // there). Saving cues on that file is a review of the track that now lives in it.
  it('closes the track whose new copy is at the path before one that only used to be there', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/b.flac', oldPath: '/m/c.flac' }))
    store.add(entry({ newPath: '/m/c.flac', oldPath: '/m/a.mp3' }))
    expect(store.review('/m/c.flac')?.newPath).toBe('/m/c.flac')
    expect(store.list().map((e) => e.newPath)).toEqual(['/m/b.flac'])
  })

  // A save in one program reviews the track that program still has to review. Another
  // track whose new copy sits at the same path, already done there, must not take it.
  it('closes the track still pending in the program that saved, even if another is at the path', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/p.flac', oldPath: '/m/b.mp3', pending: ['traktor'] }))
    store.restore(entry({ newPath: '/m/a.flac', oldPath: '/m/p.flac', pending: ['rekordbox'] }))
    expect(store.review('/m/p.flac', ['rekordbox'])?.newPath).toBe('/m/a.flac')
    expect(store.list().map((e) => e.newPath)).toEqual(['/m/p.flac'])
  })

  it('drops the entry once no program is left to review', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    store.review('/m/new.flac')
    expect(store.list()).toEqual([])
  })

  it('returns null when the track is not in the list', async () => {
    const store = createReplacedStore(await fileIn())
    expect(store.review('/m/none.flac')).toBeNull()
  })

  it('returns the entry as it was, so Undo can put it back whole', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    const before = store.list()
    store.restore(store.review('/m/new.flac') as ReplacedEntry)
    expect(store.list()).toEqual(before)
  })

  it('treats the two Unicode spellings of an accented name as one file', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/Canción.flac'.normalize('NFD') }))
    expect(store.review('/m/Canción.flac'.normalize('NFC'))).not.toBeNull()
  })

  it('a second replacement of the same track starts the review over in every program', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/a.flac', pending: ['rekordbox'] }))
    const second = entry({
      oldPath: '/m/a.flac',
      newPath: '/m/a2.flac',
      pending: [...DJ_PROGRAMS],
    })
    store.add(second)
    expect(store.list()).toEqual([second])
  })

  // While a program's repoint waits in its queue the row still shows the old file, and a
  // replacement launched from it names that old file again. It is the same track: two
  // entries would list it twice and one would never close.
  it('starts the review over when the track is replaced again from the old file a queue still shows', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/a.flac', oldPath: '/m/a.mp3' }))
    const again = entry({ newPath: '/m/a.aiff', oldPath: '/m/a.mp3', replacedAt: 2 })
    store.add(again)
    expect(store.list()).toEqual([again])
  })

  // A moved track still shows its earlier path in a program whose repoint is queued, and a
  // replacement launched from that row names it as the old file: it is the same track.
  it('starts the review over when a moved track is replaced again from the path it had before', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/a.flac', oldPath: '/m/a.mp3' }))
    store.movePath('/m/a.flac', '/m/a.aiff')
    const again = entry({ newPath: '/m/a.wav', oldPath: '/m/a.flac', replacedAt: 2 })
    store.add(again)
    expect(store.list()).toEqual([again])
  })

  it('follows the file when a later conversion moves it, without touching the old path', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    store.movePath('/m/new.flac', '/m/new.aiff')
    expect(store.list()[0].newPath).toBe('/m/new.aiff')
    expect(store.list()[0].oldPath).toBe('/m/old.mp3')
  })

  // A program whose repoint waits in its queue still shows the file the track was at
  // before the move: saving or Reviewed there must still find it, or it never closes.
  it('still finds a moved track by the path it had before, which a queued program still shows', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    store.movePath('/m/new.flac', '/m/new.aiff')
    expect(store.review('/m/new.flac')?.newPath).toBe('/m/new.aiff')
  })

  it('reads a corrupt file as an empty list instead of failing every call', async () => {
    const file = await fileIn()
    await writeFile(file, '{not json')
    expect(createReplacedStore(file).list()).toEqual([])
  })

  it('keeps the unreadable content as a .corrupt copy before the next add, so no pending review is erased', async () => {
    const file = await fileIn()
    await writeFile(file, '{not json')
    createReplacedStore(file).add(entry())
    const copies = (await readdir(dirname(file))).filter((f) =>
      f.startsWith(`${basename(file)}.corrupt`),
    )
    expect(copies).toHaveLength(1)
    expect(await readFile(join(dirname(file), copies[0]), 'utf8')).toBe('{not json')
    expect(createReplacedStore(file).list()).toEqual([entry()])
  })

  it('treats a file whose entries is not a list as corrupt and keeps it aside', async () => {
    const file = await fileIn()
    await writeFile(file, JSON.stringify({ version: 1, entries: 'x' }))
    createReplacedStore(file).add(entry())
    const copies = (await readdir(dirname(file))).filter((f) =>
      f.startsWith(`${basename(file)}.corrupt`),
    )
    expect(copies).toHaveLength(1)
  })

  it('does not write at all when the file cannot be read, since a transient failure must not wipe the list', async () => {
    const file = await fileIn()
    await mkdir(file)
    const store = createReplacedStore(file)
    store.add(entry())
    expect(store.review('/m/new.flac')).toBeNull()
    expect((await stat(file)).isDirectory()).toBe(true)
    expect(await readdir(dirname(file))).toEqual([basename(file)])
    expect(log.warn).toHaveBeenCalled()
  })

  it('does not leave two entries at the same path when a move lands on an existing one', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry({ newPath: '/m/new.flac', oldPath: '/m/old.mp3' }))
    store.add(entry({ newPath: '/m/other.flac', oldPath: '/m/other.mp3' }))
    store.movePath('/m/new.flac', '/m/other.flac')
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].oldPath).toBe('/m/old.mp3')
  })

  it('keeps the entry at the destination when nothing sits at the source', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    store.movePath('/m/ghost.flac', '/m/new.flac')
    expect(store.list()).toEqual([entry()])
  })

  it('discards an entry whose earlier paths are not a list, so a lookup never throws', async () => {
    const file = await fileIn()
    await writeFile(
      file,
      JSON.stringify({ version: 1, entries: [entry(), { ...entry(), formerPaths: 'x' }] }),
    )
    expect(createReplacedStore(file).list()).toEqual([entry()])
  })

  // The renderer normalizes every earlier path; one that is not a string, in a file edited
  // by hand, would throw there, so it is dropped on read and the entry kept.
  it('drops earlier paths that are not strings when reading, keeping the entry', async () => {
    const file = await fileIn()
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [{ ...entry(), formerPaths: ['/m/a.flac', 3, null] }],
      }),
    )
    expect(createReplacedStore(file).list()).toEqual([entry({ formerPaths: ['/m/a.flac'] })])
  })

  it('discards malformed entries when reading', async () => {
    const file = await fileIn()
    await writeFile(file, JSON.stringify({ version: 1, entries: [entry(), { newPath: 3 }, null] }))
    expect(createReplacedStore(file).list()).toEqual([entry()])
  })
})

describe('recordReplacement', () => {
  it('records an unmeasured replacement in amber rather than leaving it out', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.flac' },
      ['rekordbox'],
      1,
    )
    expect(store.list()[0].shift).toEqual({ unmoved: 'unreadable' })
  })

  it('keeps the measured shift and the programs to review', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.flac', replaceShift: { moved: 0.05 } },
      ['rekordbox', 'serato'],
      7,
    )
    expect(store.list()).toEqual([
      entry({ shift: { moved: 0.05 }, pending: ['rekordbox', 'serato'], replacedAt: 7 }),
    ])
  })

  // Serato stays on the old file when its cues could not be carried: listing it there with
  // the measured shift would tell the DJ cues moved that Serato never saw move.
  it('leaves Serato out when its cues could not be carried, since Serato was never repointed', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.flac', replaceShift: { moved: 1500 }, seratoCarryFailed: true },
      ['rekordbox', 'serato'],
      7,
    )
    expect(store.list()).toEqual([
      entry({ shift: { moved: 1500 }, pending: ['rekordbox'], replacedAt: 7 }),
    ])
  })

  it('records nothing when Serato was the only program and it stayed on the old file', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.flac', replaceShift: { moved: 1500 }, seratoCarryFailed: true },
      ['serato'],
      7,
    )
    expect(store.list()).toEqual([])
  })

  it('records nothing for a plain conversion, a skipped job or when no program follows the file', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(store, {}, { outputPath: '/m/new.flac' }, ['rekordbox'], 1)
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.flac', skipped: true },
      ['rekordbox'],
      1,
    )
    recordReplacement(store, { replacesPath: '/m/old.mp3' }, { outputPath: '/m/new.flac' }, [], 1)
    expect(store.list()).toEqual([])
  })

  it('records a Music-only landing under the file Music copied, since that is where the track now lives', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(
      store,
      { replacesPath: '/m/old.mp3' },
      { outputPath: '', replacementLandedPath: '/music/new.flac' },
      ['rekordbox'],
      1,
    )
    expect(store.list()[0].newPath).toBe('/music/new.flac')
  })

  it('records nothing when the file landed nowhere that can be named', async () => {
    const store = createReplacedStore(await fileIn())
    recordReplacement(store, { replacesPath: '/m/old.mp3' }, { outputPath: '' }, ['rekordbox'], 1)
    expect(store.list()).toEqual([])
  })
})

describe('followingPrograms', () => {
  const off = {
    syncRekordbox: false,
    syncTraktor: false,
    syncEngineDj: false,
    syncSerato: false,
    syncVirtualdj: false,
    addToRekordbox: false,
    addToTraktor: false,
    addToEngineDj: false,
    addToSerato: false,
    addToVirtualdj: false,
  }

  it('only lists the programs whose library follows the file', () => {
    expect(followingPrograms({ ...off, syncRekordbox: true, addToTraktor: true })).toEqual([
      'rekordbox',
      'traktor',
    ])
  })

  it('lists nothing when every program is off', () => {
    expect(followingPrograms(off)).toEqual([])
  })
})

describe('followReplaced', () => {
  it('moves the entry when a later job converts the replaced file elsewhere', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    followReplaced(store, { inputPath: '/m/new.flac' }, { outputPath: '/m/new.aiff' }, () => false)
    expect(store.list()[0].newPath).toBe('/m/new.aiff')
  })

  it('leaves the entry alone while the old file still exists or the job was skipped', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    followReplaced(store, { inputPath: '/m/new.flac' }, { outputPath: '/m/new.aiff' }, () => true)
    followReplaced(
      store,
      { inputPath: '/m/new.flac' },
      { outputPath: '/m/new.aiff', skipped: true },
      () => false,
    )
    expect(store.list()[0].newPath).toBe('/m/new.flac')
  })
})

describe('keepReplacedForReview', () => {
  const failing = (fails: 'movePath' | 'add') => {
    const calls: string[] = []
    const store = {
      list: () => [entry()],
      add: () => {
        calls.push('add')
        if (fails === 'add') throw new Error('disk full')
      },
      review: () => null,
      restore: () => {},
      movePath: () => {
        calls.push('movePath')
        if (fails === 'movePath') throw new Error('disk full')
      },
    }
    return { store, calls }
  }

  // The file has landed and the programs are repointed by now: a store that cannot be
  // written must never turn the finished job into a failed one.
  it('keeps a finished job finished when the review store cannot be written', () => {
    const { store } = failing('add')
    expect(() =>
      keepReplacedForReview(
        store,
        { inputPath: '/m/new.flac', replacesPath: '/m/old.mp3' },
        { outputPath: '/m/new.aiff' },
        ['rekordbox'],
        1,
        () => false,
      ),
    ).not.toThrow()
    expect(log.error).toHaveBeenCalled()
  })

  // Failing to move an older entry is no reason to lose the one this job just made.
  it('still records the replacement when following an older entry fails', () => {
    const { store, calls } = failing('movePath')
    keepReplacedForReview(
      store,
      { inputPath: '/m/new.flac', replacesPath: '/m/old.mp3' },
      { outputPath: '/m/new.aiff' },
      ['rekordbox'],
      1,
      () => false,
    )
    expect(calls).toEqual(['movePath', 'add'])
  })
})
