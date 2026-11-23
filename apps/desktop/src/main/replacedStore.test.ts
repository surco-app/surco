import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DJ_PROGRAMS } from '../shared/djProgram'
import type { ReplacedEntry } from '../shared/toReview'
import {
  createReplacedStore,
  followReplaced,
  followingPrograms,
  recordReplacement,
} from './replacedStore'

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

  it('follows the file when a later conversion moves it, without touching the old path', async () => {
    const store = createReplacedStore(await fileIn())
    store.add(entry())
    store.movePath('/m/new.flac', '/m/new.aiff')
    expect(store.list()[0].newPath).toBe('/m/new.aiff')
    expect(store.list()[0].oldPath).toBe('/m/old.mp3')
  })

  it('reads a corrupt file as an empty list instead of failing every call', async () => {
    const file = await fileIn()
    await writeFile(file, '{not json')
    expect(createReplacedStore(file).list()).toEqual([])
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
      { outputPath: '', musicLandedPath: '/music/new.flac' },
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
