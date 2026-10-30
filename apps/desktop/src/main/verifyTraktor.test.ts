import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { applyPatches, matchedEntryCues, matchedEntryFiles, type NmlPatch } from './traktorNml'
import { checkTraktor, type TraktorExpect } from './verifyTraktor'

const BOOT = 'Macintosh HD'

const entry = (file: string, volume = 'Public', dir = '/:Musica/:Artist/:') =>
  `<ENTRY MODIFIED_DATE="2026/10/30" TITLE="Title" ARTIST="Artist">
<LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}"></LOCATION>
</ENTRY>`

const withCue = (block: string, start: string) =>
  block.replace(
    '</LOCATION>',
    `</LOCATION><CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="${start}.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>`,
  )

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

// The output went to another folder: no rename, and the entry stays on the source.
const elsewhere: Partial<NmlPatch> = {
  newFile: undefined,
  outputVolume: 'Public',
  outputDir: '/:Out/:',
  outputFile: 'Title.aiff',
}

// What the flush does: read which entry each patch matches, write, then check the result.
function flush(original: string, patches: NmlPatch[], stranded = false) {
  const before = matchedEntryFiles(original, patches)
  const cues = matchedEntryCues(original, patches)
  const list: TraktorExpect[] = patches.map((p, i) => ({
    patch: p,
    before: before[i],
    cues: cues[i],
    stranded,
  }))
  return { list, written: applyPatches(original, patches) }
}

const stillOld = (format: string) => ({
  place: 'traktor',
  state: 'mismatch',
  detail: { key: 'traktorStillOld', params: { format } },
})

describe('checkTraktor', () => {
  // The rename is the whole point of the patch: the entry, its cues and its playlists now
  // name the file that exists.
  it('an entry renamed to the WAV is traktorOk', () => {
    const { list, written } = flush(nml(entry('Title.aiff')), [patch()])
    expect(checkTraktor(written, list, BOOT)).toEqual([
      { place: 'traktor', state: 'ok', detail: { key: 'traktorOk', params: { format: 'WAV' } } },
    ])
  })

  it('an entry still on the AIFF is traktorStillOld', () => {
    const original = nml(entry('Title.aiff'))
    const { list } = flush(original, [patch()])
    expect(checkTraktor(original, list, BOOT)).toEqual([stillOld('AIFF')])
  })

  // The collection already had an entry on the WAV, so the AIFF's entry was left alone:
  // Traktor still plays a file the conversion replaced.
  it('an entry on the WAV beside one still on the AIFF is traktorStillOld', () => {
    const { list, written } = flush(nml(entry('Title.aiff'), entry('Title.wav')), [patch()])
    expect(checkTraktor(written, list, BOOT)).toEqual([stillOld('AIFF')])
  })

  // On a case-insensitive volume a recased name is the same file: an entry left there is
  // still on the replaced file, never silence.
  it('an entry still on the source under another casing is traktorStillOld', () => {
    const { list } = flush(nml(entry('Title.aiff')), [patch()])
    expect(checkTraktor(nml(entry('Title.AIFF')), list, BOOT)).toEqual([stillOld('AIFF')])
  })

  // The entry the patch matched is gone from the collection: a lost track, not one Traktor
  // never had.
  it('an entry that was matched and is at neither name is traktorMissing', () => {
    const { list } = flush(nml(entry('Title.aiff')), [patch()])
    expect(checkTraktor(nml(entry('Other.aiff')), list, BOOT)).toEqual([
      { place: 'traktor', state: 'mismatch', detail: { key: 'traktorMissing' } },
    ])
  })

  // The entry Traktor had shares only the stem with the converted source; the old name to
  // look for is the entry's, not the patch's.
  it('an entry matched by stem follows the rename, and left behind is traktorStillOld', () => {
    const original = nml(entry('Title.aiff'))
    const { list, written } = flush(original, [patch({ file: 'Title.flac' })])
    expect(list[0].before).toBe('Title.aiff')
    expect(checkTraktor(written, list, BOOT)[0]?.detail.key).toBe('traktorOk')
    expect(checkTraktor(original, list, BOOT)).toEqual([stillOld('AIFF')])
  })

  // macOS and SMB hand Surco NFD names; Traktor keeps whatever it was given.
  it('an NFD FILE attribute matches', () => {
    const p = patch({ file: 'Café.aiff'.normalize('NFC'), newFile: 'Café.wav'.normalize('NFC') })
    const { list, written } = flush(nml(entry('Café.aiff'.normalize('NFD'))), [p])
    expect(checkTraktor(written, list, BOOT)[0]?.state).toBe('ok')
  })

  it('an NFD DIR attribute matches', () => {
    const p = patch({ dir: '/:Música/:'.normalize('NFC') })
    const original = nml(entry('Title.aiff', 'Public', '/:Música/:'.normalize('NFD')))
    const { list, written } = flush(original, [p])
    expect(checkTraktor(written, list, BOOT)[0]?.state).toBe('ok')
  })

  // Finder spelled the converted name decomposed and Traktor composed: one entry is both
  // the old name and the new one, and it is on the file.
  it('a new name that only differs in composition is traktorOk', () => {
    const p = patch({ file: 'Café.wav'.normalize('NFC'), newFile: 'Café.wav'.normalize('NFD') })
    const { list, written } = flush(nml(entry('Café.wav'.normalize('NFC'))), [p])
    expect(checkTraktor(written, list, BOOT)[0]?.state).toBe('ok')
  })

  // The output landed in another folder, so the entry stays on the source, whose audio did
  // not change: its cues have to read exactly as they did before the write.
  it('an entry left on the source with its cues as they were is traktorOk', () => {
    const { list, written } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', ...elsewhere }),
    ])
    expect(checkTraktor(written, list, BOOT)).toEqual([
      { place: 'traktor', state: 'ok', detail: { key: 'traktorOk', params: { format: 'MP3' } } },
    ])
  })

  it('an entry left on the source whose cues moved is traktorCuesChanged', () => {
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', ...elsewhere }),
    ])
    expect(checkTraktor(nml(withCue(entry('Title.mp3'), '9949')), list, BOOT)).toEqual([
      { place: 'traktor', state: 'mismatch', detail: { key: 'traktorCuesChanged' } },
    ])
  })

  // Traktor rewrites the whole collection when it quits, in its own spelling: the same cues
  // in another attribute order, closed on themselves, with the position written shorter.
  it('the same cues as Traktor writes them back are traktorOk', () => {
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', ...elsewhere }),
    ])
    const rewritten = entry('Title.mp3').replace(
      '</LOCATION>',
      '</LOCATION><CUE_V2 HOTCUE="1" TYPE="0" START="10000" LEN="0" NAME="Drop" DISPL_ORDER="0" REPEATS="-1"/>',
    )
    expect(checkTraktor(nml(rewritten), list, BOOT)[0]?.detail.key).toBe('traktorOk')
  })

  // A grid Traktor adds once it analyses the track, or a cue the DJ sets before a retry, is
  // not something the write did; only the cues that were there are held to their place.
  it('a cue added after the write leaves the entry traktorOk', () => {
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', ...elsewhere }),
    ])
    const analysed = withCue(entry('Title.mp3'), '10000').replace(
      '</ENTRY>',
      '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="31.5" LEN="0" REPEATS="-1" HOTCUE="-1"></CUE_V2></ENTRY>',
    )
    expect(checkTraktor(nml(analysed), list, BOOT)[0]?.detail.key).toBe('traktorOk')
  })

  it('a cue that was there and is gone is traktorCuesChanged', () => {
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', ...elsewhere }),
    ])
    expect(checkTraktor(nml(entry('Title.mp3')), list, BOOT)[0]?.detail.key).toBe(
      'traktorCuesChanged',
    )
  })

  it('one of two cues on the same spot gone is traktorCuesChanged', () => {
    const twice = withCue(withCue(entry('Title.mp3'), '10000'), '10000')
    const { list } = flush(nml(twice), [patch({ file: 'Title.mp3', ...elsewhere })])
    expect(checkTraktor(nml(withCue(entry('Title.mp3'), '10000')), list, BOOT)[0]?.detail.key).toBe(
      'traktorCuesChanged',
    )
  })

  // Reconverted in place under the same name (a trim, a quality change): the source entry IS
  // the output, and its cues were rewritten on purpose to follow the file.
  it('an entry the conversion rewrote in place produces no check', () => {
    const inPlace = patch({
      file: 'Title.mp3',
      newFile: undefined,
      outputVolume: 'Public',
      outputDir: '/:Musica/:Artist/:',
      outputFile: 'Title.mp3',
    })
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [inPlace])
    expect(checkTraktor(nml(withCue(entry('Title.mp3'), '8000')), list, BOOT)).toEqual([null])
  })

  it('a patch that names no output produces no check', () => {
    const { list } = flush(nml(withCue(entry('Title.mp3'), '10000')), [
      patch({ file: 'Title.mp3', newFile: undefined }),
    ])
    expect(checkTraktor(nml(withCue(entry('Title.mp3'), '8000')), list, BOOT)).toEqual([null])
  })

  // Two entries on one file can hold different cues, and nothing says which one the write
  // read: the duplicate is the finding, like on a rename.
  it('two entries left on the source are traktorAmbiguous, never a cue change', () => {
    const original = nml(withCue(entry('Title.mp3'), '10000'), withCue(entry('Title.mp3'), '20000'))
    const { list, written } = flush(original, [patch({ file: 'Title.mp3', ...elsewhere })])
    expect(checkTraktor(written, list, BOOT)).toEqual([
      {
        place: 'traktor',
        state: 'mismatch',
        detail: { key: 'traktorAmbiguous', params: { count: 2 } },
      },
    ])
  })

  it('an entry left on the source that is gone is traktorMissing', () => {
    const { list } = flush(nml(entry('Title.mp3')), [patch({ file: 'Title.mp3', ...elsewhere })])
    expect(checkTraktor(nml(entry('Other.mp3')), list, BOOT)[0]?.detail.key).toBe('traktorMissing')
  })

  // A patch is recorded for every conversion while the sync is on; a track Traktor never
  // had was not touched there.
  it('a track the collection did not have produces no check', () => {
    const { list, written } = flush(nml(entry('Other.aiff')), [patch()])
    expect(list[0].before).toBeNull()
    expect(checkTraktor(written, list, BOOT)).toEqual([null])
  })

  // The file landed in Music's folder, and Traktor can only rename within the same one.
  it('a stranded patch whose entry stays on the AIFF is traktorStillOld', () => {
    const { list, written } = flush(nml(entry('Title.aiff')), [patch({ newFile: undefined })], true)
    expect(checkTraktor(written, list, BOOT)).toEqual([stillOld('AIFF')])
  })

  it('a stranded patch whose entry is gone is traktorMissing', () => {
    const { list } = flush(nml(entry('Title.aiff')), [patch({ newFile: undefined })], true)
    expect(checkTraktor(nml(entry('Other.aiff')), list, BOOT)[0]?.detail.key).toBe('traktorMissing')
  })

  it('two entries on the WAV are traktorAmbiguous, never ok', () => {
    const { list, written } = flush(nml(entry('Title.aiff'), entry('Title.aiff')), [patch()])
    expect(checkTraktor(written, list, BOOT)[0]).toEqual({
      place: 'traktor',
      state: 'mismatch',
      detail: { key: 'traktorAmbiguous', params: { count: 2 } },
    })
  })

  // Traktor stores the internal disk by name; a patch built from the path leaves it empty.
  it('a patch on the boot volume matches the entry under its name', () => {
    const p = patch({ volume: '' })
    const list: TraktorExpect[] = [{ patch: p, before: 'Title.aiff', stranded: false }]
    expect(checkTraktor(nml(entry('Title.wav', BOOT)), list, BOOT)[0]?.state).toBe('ok')
  })

  it('judges every track of the batch in order', () => {
    const a = patch()
    const b = patch({ file: 'B.aiff', newFile: 'B.wav' })
    const c = patch({ file: 'C.aiff', ...elsewhere })
    const original = nml(entry('Title.aiff'), entry('B.aiff'), entry('C.aiff'))
    const before = matchedEntryFiles(original, [a, b, c])
    const cues = matchedEntryCues(original, [a, b, c])
    const written = applyPatches(original, [a])
    expect(
      checkTraktor(
        written,
        [a, b, c].map((p, i) => ({ patch: p, before: before[i], cues: cues[i], stranded: false })),
        BOOT,
      ).map((r) => r?.detail.key ?? null),
    ).toEqual(['traktorOk', 'traktorStillOld', 'traktorOk'])
  })
})
