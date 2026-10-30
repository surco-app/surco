import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { applyPatches, type NmlPatch } from './traktorNml'
import { checkTraktor, type TraktorExpect } from './verifyTraktor'

const entry = (file: string, volume = 'Public', dir = '/:Musica/:Artist/:') =>
  `<ENTRY MODIFIED_DATE="2026/10/30" TITLE="Title" ARTIST="Artist">
<LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}"></LOCATION>
</ENTRY>`

const nml = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<COLLECTION ENTRIES="${entries.length}">
${entries.join('\n')}
</COLLECTION>
</NML>`

const patch = (over: Partial<NmlPatch> = {}): NmlPatch => ({
  volume: 'Public',
  dir: '/:Musica/:Artist/:',
  file: 'Title.aiff',
  newFile: 'Title.wav',
  ...over,
})

const expectFor = (p: NmlPatch, over: Partial<TraktorExpect> = {}): TraktorExpect => ({
  patch: p,
  oldFile: p.file,
  ...over,
})

describe('checkTraktor', () => {
  // The rename is the whole point of the patch: the entry, its cues and its playlists now
  // name the file that exists.
  it('an entry renamed to the WAV is traktorOk', () => {
    const p = patch()
    const written = applyPatches(nml(entry('Title.aiff')), [p])
    expect(checkTraktor(written, [expectFor(p)])).toEqual([
      { place: 'traktor', state: 'ok', detail: { key: 'traktorOk', params: { format: 'WAV' } } },
    ])
  })

  it('an entry still on the AIFF is traktorStillOld', () => {
    const p = patch()
    expect(checkTraktor(nml(entry('Title.aiff')), [expectFor(p)])).toEqual([
      {
        place: 'traktor',
        state: 'mismatch',
        detail: { key: 'traktorStillOld', params: { format: 'AIFF' } },
      },
    ])
  })

  // The collection already had an entry on the WAV, so the AIFF's entry was left alone:
  // Traktor still plays a file the conversion replaced.
  it('an entry on the WAV beside one still on the AIFF is traktorStillOld', () => {
    const p = patch()
    const written = applyPatches(nml(entry('Title.aiff'), entry('Title.wav')), [p])
    expect(checkTraktor(written, [expectFor(p)])[0]?.detail.key).toBe('traktorStillOld')
  })

  // The entry Traktor had shares only the stem with the converted source: the old name to
  // look for is the entry's, not the patch's.
  it('an entry still on the old name the patch did not carry is traktorStillOld', () => {
    const p = patch({ file: 'Title.flac' })
    const collection = nml(entry('Title.aiff'))
    expect(checkTraktor(collection, [expectFor(p, { oldFile: 'Title.aiff' })])[0]?.detail).toEqual({
      key: 'traktorStillOld',
      params: { format: 'AIFF' },
    })
  })

  // macOS and SMB hand Surco NFD names; Traktor keeps whatever it was given.
  it('an NFD FILE attribute matches', () => {
    const p = patch({ file: 'Café.aiff'.normalize('NFC'), newFile: 'Café.wav'.normalize('NFC') })
    const collection = nml(entry('Café.wav'.normalize('NFD')))
    expect(checkTraktor(collection, [expectFor(p)])[0]?.state).toBe('ok')
  })

  it('an NFD DIR attribute matches', () => {
    const p = patch({ dir: '/:Música/:'.normalize('NFC') })
    const collection = nml(entry('Title.wav', 'Public', '/:Música/:'.normalize('NFD')))
    expect(checkTraktor(collection, [expectFor(p)])[0]?.state).toBe('ok')
  })

  // Finder spelled the converted name decomposed and Traktor composed: one entry is both
  // the old name and the new one, and it is on the file.
  it('a new name that only differs in composition is traktorOk', () => {
    const p = patch({ file: 'Café.wav'.normalize('NFC'), newFile: 'Café.wav'.normalize('NFD') })
    const collection = nml(entry('Café.wav'.normalize('NFC')))
    expect(checkTraktor(collection, [expectFor(p)])[0]?.state).toBe('ok')
  })

  it('a patch without newFile produces no check', () => {
    const p = patch({ newFile: undefined })
    expect(checkTraktor(nml(entry('Title.aiff')), [expectFor(p)])).toEqual([null])
  })

  // A patch is recorded for every conversion while the sync is on; a track Traktor never
  // had was not touched there.
  it('a track the collection has at neither name produces no check', () => {
    expect(checkTraktor(nml(entry('Other.aiff')), [expectFor(patch())])).toEqual([null])
  })

  // The file landed in Music's folder, and Traktor can only rename within the same one.
  it('a stranded patch whose entry stays on the AIFF is traktorStillOld', () => {
    const p = patch({ newFile: undefined })
    expect(checkTraktor(nml(entry('Title.aiff')), [expectFor(p, { stranded: true })])).toEqual([
      {
        place: 'traktor',
        state: 'mismatch',
        detail: { key: 'traktorStillOld', params: { format: 'AIFF' } },
      },
    ])
  })

  it('a stranded patch for a track Traktor does not have produces no check', () => {
    const p = patch({ newFile: undefined })
    expect(checkTraktor(nml(entry('Other.aiff')), [expectFor(p, { stranded: true })])).toEqual([
      null,
    ])
  })

  it('two entries on the WAV are traktorAmbiguous, never ok', () => {
    const collection = nml(entry('Title.wav'), entry('Title.wav'))
    expect(checkTraktor(collection, [expectFor(patch())])[0]).toEqual({
      place: 'traktor',
      state: 'mismatch',
      detail: { key: 'traktorAmbiguous', params: { count: 2 } },
    })
  })

  // Traktor stores the internal disk by name; a patch built from the path leaves it empty.
  it('a patch on the boot volume matches the entry under its name', () => {
    const p = patch({ volume: '' })
    const collection = nml(entry('Title.wav', 'Macintosh HD'))
    expect(checkTraktor(collection, [expectFor(p)], 'Macintosh HD')[0]?.state).toBe('ok')
  })

  it('an entry in another folder is not the one renamed', () => {
    const collection = nml(entry('Title.wav', 'Public', '/:Otra/:'))
    expect(checkTraktor(collection, [expectFor(patch())])).toEqual([null])
  })

  it('judges every track of the batch in order', () => {
    const a = patch()
    const b = patch({ file: 'B.aiff', newFile: 'B.wav' })
    const c = patch({ file: 'C.aiff', newFile: undefined })
    const written = applyPatches(nml(entry('Title.aiff'), entry('B.aiff'), entry('C.aiff')), [a])
    expect(
      checkTraktor(written, [expectFor(a), expectFor(b), expectFor(c)]).map(
        (r) => r?.detail.key ?? null,
      ),
    ).toEqual(['traktorOk', 'traktorStillOld', null])
  })
})
