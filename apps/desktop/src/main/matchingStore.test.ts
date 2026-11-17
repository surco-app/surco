import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMatchingStore, followConversion } from './matchingStore'

async function fileIn(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'surco-matchstore-')), 'matching-pairs.json')
}

describe('createMatchingStore', () => {
  it('keeps a pair across restarts, so what the DJ marked is still there tomorrow', async () => {
    const file = await fileIn()
    createMatchingStore(file).add('/m/a.wav', '/m/b.wav')
    expect(createMatchingStore(file).list()).toEqual([['/m/a.wav', '/m/b.wav']])
  })

  it('keeps a pair once whichever track was named first', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.wav', '/m/b.wav')
    store.add('/m/b.wav', '/m/a.wav')
    expect(store.list()).toHaveLength(1)
  })

  it('treats the two Unicode spellings of an accented name as one file', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/Canción.wav'.normalize('NFD'), '/m/b.wav')
    store.add('/m/Canción.wav'.normalize('NFC'), '/m/b.wav')
    expect(store.list()).toEqual([['/m/Canción.wav'.normalize('NFC'), '/m/b.wav']])
  })

  it('never pairs a file with itself', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.wav', '/m/a.wav')
    expect(store.list()).toEqual([])
  })

  it('removes a pair in either order', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.wav', '/m/b.wav')
    store.add('/m/a.wav', '/m/c.wav')
    store.remove('/m/b.wav', '/m/a.wav')
    expect(store.list()).toEqual([['/m/a.wav', '/m/c.wav']])
  })

  it('removes many pairs at once, each in either order, so emptying Matching is one change to the file', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.wav', '/m/b.wav')
    store.add('/m/a.wav', '/m/c.wav')
    store.add('/m/c.wav', '/m/d.wav')
    store.removeAll([
      ['/m/b.wav', '/m/a.wav'],
      ['/m/c.wav', '/m/d.wav'],
    ])
    expect(store.list()).toEqual([['/m/a.wav', '/m/c.wav']])
  })

  it('moves every pair of a file to its new path, as when a conversion replaced it', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.mp3', '/m/b.wav')
    store.add('/m/c.wav', '/m/a.mp3')
    store.movePath('/m/a.mp3', '/m/a.aiff')
    expect(store.list()).toEqual([
      ['/m/a.aiff', '/m/b.wav'],
      ['/m/c.wav', '/m/a.aiff'],
    ])
  })

  it('merges a pair that the move turns into one it already had', async () => {
    const store = createMatchingStore(await fileIn())
    store.add('/m/a.mp3', '/m/b.wav')
    store.add('/m/a.aiff', '/m/b.wav')
    store.movePath('/m/a.mp3', '/m/a.aiff')
    expect(store.list()).toEqual([['/m/a.aiff', '/m/b.wav']])
  })

  it('starts empty from a file a crash or a hand edit left unreadable, instead of failing', async () => {
    const file = await fileIn()
    await writeFile(file, '{not json')
    expect(createMatchingStore(file).list()).toEqual([])
  })

  it('writes through a temporary file, so a crash mid-write never leaves half a list', async () => {
    const file = await fileIn()
    createMatchingStore(file).add('/m/a.wav', '/m/b.wav')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      pairs: [['/m/a.wav', '/m/b.wav']],
    })
  })
})

describe('followConversion', () => {
  async function storeWith(...pairs: [string, string][]) {
    const store = createMatchingStore(await fileIn())
    for (const [a, b] of pairs) store.add(a, b)
    return store
  }
  const gone =
    (...paths: string[]) =>
    (p: string) =>
      !paths.includes(p)

  it('moves the pairs to the converted file when the original is gone', async () => {
    const store = await storeWith(['/m/a.mp3', '/m/b.wav'])
    followConversion(
      store,
      { inputPath: '/m/a.mp3' },
      { outputPath: '/m/a.aiff' },
      gone('/m/a.mp3'),
    )
    expect(store.list()).toEqual([['/m/a.aiff', '/m/b.wav']])
  })

  it('leaves the pairs on the original when the conversion kept it, since that file still plays', async () => {
    const store = await storeWith(['/m/a.mp3', '/m/b.wav'])
    followConversion(store, { inputPath: '/m/a.mp3' }, { outputPath: '/out/a.aiff' }, gone())
    expect(store.list()).toEqual([['/m/a.mp3', '/m/b.wav']])
  })

  it('moves the pairs of the copy a substitution replaced, so the better copy keeps them', async () => {
    const store = await storeWith(['/lib/old.mp3', '/m/b.wav'])
    followConversion(
      store,
      { inputPath: '/new/a.flac', replacesPath: '/lib/old.mp3' },
      { outputPath: '/lib/a.aiff' },
      gone('/lib/old.mp3'),
    )
    expect(store.list()).toEqual([['/lib/a.aiff', '/m/b.wav']])
  })

  it('does nothing for a conversion the DJ skipped', async () => {
    const store = await storeWith(['/m/a.mp3', '/m/b.wav'])
    followConversion(
      store,
      { inputPath: '/m/a.mp3' },
      { outputPath: '/m/a.aiff', skipped: true },
      gone('/m/a.mp3'),
    )
    expect(store.list()).toEqual([['/m/a.mp3', '/m/b.wav']])
  })
})
