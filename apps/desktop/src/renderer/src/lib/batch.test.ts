import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem, TrackStatus } from '../types'
import { buildLibraryIndex } from './appleMusicLibrary'
import {
  type BatchPick,
  batchFormats,
  batchWritesTagsOnly,
  canProcessTrack,
  convertGate,
  convertReadiness,
  eligibleForBatch,
  leavesListAfterBatch,
  leftOutForMissing,
  leftOutNote,
  offersSourceFormat,
  summarizeBatch,
} from './batch'

function track(id: string, status: TrackStatus, meta: Partial<TrackMetadata> = {}): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: id,
    listLabel: meta.title ?? id,
    query: '',
    status,
    meta: {
      title: '',
      artist: '',
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
      ...meta,
    },
  }
}

describe('eligibleForBatch', () => {
  it('includes idle and previously failed tracks', () => {
    const tracks = [track('a', 'idle'), track('b', 'error')]
    expect(eligibleForBatch(tracks, [])).toEqual(['a', 'b'])
  })

  it('skips tracks already done or currently processing', () => {
    const tracks = [track('a', 'done'), track('b', 'processing'), track('c', 'idle')]
    expect(eligibleForBatch(tracks, [])).toEqual(['c'])
  })

  it('returns an empty list when nothing is pending', () => {
    expect(eligibleForBatch([track('a', 'done')], [])).toEqual([])
  })

  it('re-includes a done track edited since it was converted (stale)', () => {
    // After converting, the user fills a tag Discogs lacked (e.g. the year) across the
    // selection; the file no longer matches the editor, so "Convert all" must pick the
    // track up again rather than skip it as already done — otherwise the edit never lands.
    const stale = { ...track('a', 'done', { year: '2000' }), processedSignature: 'old-snapshot' }
    expect(eligibleForBatch([stale], [])).toEqual(['a'])
  })

  it('leaves out a convertible track that is missing a required field', () => {
    // The toolbar "Convert (N)" used to count and enable on status alone, so it offered a
    // batch that would only error the incomplete track. The batch now skips it (it stays
    // flagged in the list) — the same gate the single-track convert button enforces.
    const tracks = [track('a', 'idle', { artist: 'Alex' }), track('b', 'idle')]
    expect(eligibleForBatch(tracks, ['artist'])).toEqual(['a'])
  })
})

// "le falta Título, Artista" reads as a list cut short; the language's own list words say
// it as a sentence would ("Título y Artista", "Title and Artist"), and the verb agrees with
// how many fields are missing ("le faltan" for two, "le falta" for one).
describe('leftOutNote', () => {
  const gate = (fields: string[]) => ({ missing: { count: 1, fields }, serato: 0, mixed: false })
  const noteIn = async (language: string, fields: string[]) => {
    await i18n.changeLanguage(language)
    try {
      return leftOutNote(gate(fields), i18n.getFixedT(language), language)
    } finally {
      await i18n.changeLanguage('en')
    }
  }

  it.each([
    ['en', 'Title and Artist'],
    ['es', 'le faltan Título y Artista'],
    ['ca', 'li falten Títol i Artista'],
    ['de', 'ihm fehlen Titel und Künstler'],
    ['it', 'mancano Titolo e Artista'],
    ['pt-BR', 'faltam Título e Artista'],
  ])(
    'joins several missing fields with the %s list words and a plural verb',
    async (language, said) => {
      expect(await noteIn(language, ['title', 'artist'])).toContain(said)
    },
  )

  it('keeps the singular verb for one missing field', async () => {
    expect(await noteIn('es', ['artist'])).toContain('le falta Artista')
  })

  // Three tracks out, one of them holding its title: «les faltan Título y Artista» told the
  // user all three lacked a title, a claim the selection itself denied. When the tracks do
  // not all lack every named field, the fields read as alternatives, with the verb a single
  // field takes.
  it.each([
    ['es', '3 pistas se quedan fuera porque les falta Título o Artista'],
    ['en', '3 tracks left out, they have no Title or Artist'],
  ])(
    'joins the fields as alternatives in %s when the tracks lack different ones',
    async (language, said) => {
      const tracks = [track('a', 'idle'), track('b', 'idle'), track('c', 'idle', { title: 'Song' })]
      await i18n.changeLanguage(language)
      try {
        const gate = convertGate(tracks, ['title', 'artist'])
        expect(leftOutNote(gate, i18n.getFixedT(language), language)).toBe(said)
      } finally {
        await i18n.changeLanguage('en')
      }
    },
  )
})

describe('leftOutForMissing', () => {
  // "Convert 5 of 6" gave no reason, and the reason sat in the left-out track's own footer.
  // The count says how many a missing required field keeps out and which fields, in the
  // order Settings lists them; tracks out for their state are not this note's business.
  it('counts the tracks a missing required field keeps out and names the fields', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'idle', { title: 'T' }),
      track('c', 'idle'),
      track('d', 'done'),
    ]
    expect(leftOutForMissing(tracks, ['title', 'artist'])).toEqual({
      count: 2,
      fields: ['title', 'artist'],
      apart: true,
    })
  })
})

describe('convertGate', () => {
  // The header, the editor footer, ⌘⇧↵ and the palette each had their own answer to "what
  // does Convert do with this selection": the header converted 10 of 12 and named the two
  // out for a missing field, the footer refused all 12 for the same two, and only the
  // footer knew about Serato rows and mixed replace/add selections (06/11). One gate, read
  // by all of them, so the two buttons can't contradict each other over one selection.
  it('splits a selection into the rows ready to convert and why the rest stay out', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'idle', { title: 'T' }),
      { ...track('c', 'idle', { title: 'T', artist: 'A' }), programs: ['serato' as const] },
      track('d', 'done', { title: 'T', artist: 'A' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'])
    expect(gate.ready.map((t) => t.id)).toEqual(['a'])
    expect(gate.missing).toEqual({ count: 1, fields: ['artist'] })
    expect(gate.serato).toBe(1)
    expect(gate.mixed).toBe(false)
  })

  it('converts the VirtualDJ rows and leaves only the Serato ones out, since VirtualDJ follows a track to its new file', () => {
    const tracks = [
      { ...track('s', 'idle', { title: 'T', artist: 'A' }), programs: ['serato' as const] },
      { ...track('v', 'idle', { title: 'T', artist: 'A' }), programs: ['virtualdj' as const] },
      { ...track('w', 'idle', { title: 'T', artist: 'A' }), programs: ['virtualdj' as const] },
    ]
    const gate = convertGate(tracks, ['title', 'artist'])
    expect(gate.ready.map((t) => t.id)).toEqual(['v', 'w'])
    expect(gate.serato).toBe(1)
  })

  // A batch that would replace a library copy for some rows and add the others cannot be
  // honestly done by one click, so nothing is ready and the reason is the mix itself.
  it('holds the whole selection back when it mixes replacing a library copy with adding', () => {
    const index = buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'PID2' }])
    const tracks = [
      track('a', 'idle', { title: 'Sunrise', artist: 'Halo' }),
      track('b', 'idle', { title: 'Unknown Song', artist: 'Nobody' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'], [], index)
    expect(gate.ready).toEqual([])
    expect(gate.mixed).toBe(true)
  })

  // The done menu's "Convert again" is a deliberate re-run over converted tracks, so the
  // gate takes done rows too; the plain gate skipped them and the menu converted nothing.
  it('takes done tracks too when the run is a deliberate convert again', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'done', { title: 'T', artist: 'A' }),
      track('c', 'done', { title: 'T' }),
      track('d', 'processing', { title: 'T', artist: 'A' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'], [], null, true)
    expect(gate.ready.map((t) => t.id)).toEqual(['a', 'b'])
    expect(gate.missing).toEqual({ count: 1, fields: ['artist'] })
    expect(eligibleForBatch(tracks, ['title', 'artist'], [], true)).toEqual(['a', 'b'])
  })

  // Replace-vs-add is a question about a batch; a single track is never "mixed", and its
  // ambiguous match is handled where the single convert decides what to stamp.
  it('never calls a single track mixed', () => {
    const index = buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'PID2' }])
    const gate = convertGate(
      [track('a', 'idle', { title: 'Sunrise', artist: 'Halo' })],
      ['title'],
      [],
      index,
    )
    expect(gate.ready.map((t) => t.id)).toEqual(['a'])
    expect(gate.mixed).toBe(false)
  })
})

describe('canProcessTrack', () => {
  // The keyboard shortcut and command palette must enforce the same gate as the
  // convert button, so a track with empty required fields can't slip through and
  // fail mid-process.
  it('allows converting an idle track whose required fields are filled', () => {
    expect(
      canProcessTrack(track('a', 'idle', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('allows retrying a previously failed track', () => {
    expect(
      canProcessTrack(track('a', 'error', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('blocks when a required field is empty', () => {
    expect(canProcessTrack(track('a', 'idle', { title: 'Gold' }), ['title', 'artist'])).toBe(false)
  })

  it('blocks tracks already done or currently processing', () => {
    expect(canProcessTrack(track('a', 'done', { title: 'x', artist: 'y' }), ['title'])).toBe(false)
    expect(canProcessTrack(track('a', 'processing', { title: 'x' }), ['title'])).toBe(false)
  })

  // A custom field marked required reads through the same resolution as the form: the
  // value the file carries counts, so a tagged track is not blocked by a field it fills.
  it('checks a required custom field against the value the file carries', () => {
    const fields = [{ key: 'vinylCondition', label: 'Estado del vinilo' }]
    const tagged = {
      ...track('a', 'idle', { title: 'x' }),
      foreignTags: [{ name: 'VINYLCONDITION', value: 'NM' }],
    }
    expect(canProcessTrack(tagged, ['title', 'vinylCondition'], fields)).toBe(true)
    expect(canProcessTrack(track('b', 'idle', { title: 'x' }), ['vinylCondition'], fields)).toBe(
      false,
    )
  })

  it('allows re-converting a done track edited since it was processed', () => {
    const stale = { ...track('a', 'done', { title: 'x', artist: 'y' }), processedSignature: 'old' }
    expect(canProcessTrack(stale, ['title', 'artist'])).toBe(true)
  })
})

describe('summarizeBatch', () => {
  // After a batch the user needs to know the outcome without scanning the list,
  // so the run is reduced to how many converted, were skipped and failed.
  it('counts converted and failed tracks', () => {
    expect(summarizeBatch(['converted', 'failed', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 1,
    })
  })

  it('reports zero failures when every track converted', () => {
    expect(summarizeBatch(['converted', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 0,
    })
  })

  // A skip past a file conflict is a deliberate no-op, not an error, so it must
  // not inflate the failure count the user reads as "something went wrong".
  it('counts a skipped track on its own, not as a failure', () => {
    expect(summarizeBatch(['converted', 'skipped', 'failed'])).toEqual({
      converted: 1,
      skipped: 1,
      failed: 1,
    })
  })
})

describe('a Serato track', () => {
  it('is never converted, since Serato would lose the track and its cues', () => {
    const serato = { ...track('s', 'idle'), programs: ['serato' as const] }
    expect(canProcessTrack(serato, [])).toBe(false)
  })

  it('is left out of a batch while the other tracks of the selection still convert', () => {
    const tracks = [{ ...track('s', 'idle'), programs: ['serato' as const] }, track('a', 'idle')]
    expect(eligibleForBatch(tracks, [])).toEqual(['a'])
  })

  it('leaves a rekordbox track converting as before', () => {
    expect(canProcessTrack({ ...track('r', 'idle'), programs: ['rekordbox' as const] }, [])).toBe(
      true,
    )
  })
})

// The batch button says what the run will do, so it has to work it out the way the run
// does, track by track: the format each file really ends in, where it really goes, and
// whether a library already holds it. Every case here was once answered by a shortcut
// that read "Convert" over a batch that only rewrote tags, or the other way round.
describe('batchWritesTagsOnly', () => {
  const quiet = (): object => ({})
  const base = {
    outputFormat: 'aiff' as const,
    keepMp3Sources: false,
    overwriteOriginal: false,
    convertBesideOriginal: false,
    addToAppleMusic: false,
  }
  const pick = (over: Partial<BatchPick> = {}): BatchPick => ({
    format: 'source',
    formatByHand: true,
    settings: base,
    ...over,
  })
  const wav = track('a', 'idle')
  const mp3 = { ...track('b', 'idle'), inputPath: '/b.mp3' }
  const flac = { ...track('f', 'idle'), inputPath: '/f.flac' }

  it('holds when every file keeps its format and is rewritten where it is', () => {
    expect(batchWritesTagsOnly([wav, mp3], pick({ destination: 'overwrite' }), quiet)).toBe(true)
    expect(
      batchWritesTagsOnly([wav], pick({ format: 'wav', destination: 'overwrite' }), quiet),
    ).toBe(true)
  })

  it('fails as soon as one file changes format', () => {
    expect(
      batchWritesTagsOnly([wav, mp3], pick({ format: 'wav', destination: 'overwrite' }), quiet),
    ).toBe(false)
  })

  it('fails when the audio is processed', () => {
    const normalized = (): object => ({ normalize: { mode: 'peak' } })
    expect(batchWritesTagsOnly([wav], pick({ destination: 'overwrite' }), normalized)).toBe(false)
  })

  it('fails next to the original, which always leaves a new file', () => {
    expect(batchWritesTagsOnly([wav], pick({ destination: 'beside' }), quiet)).toBe(false)
  })

  // The file is tagged where it is and then added: Music does not get a copy made for it.
  // That holds for a FLAC too, which is tagged and simply not added.
  it('holds for Apple Music, FLAC included', () => {
    expect(batchWritesTagsOnly([wav, mp3, flac], pick({ destination: 'appleMusic' }), quiet)).toBe(
      true,
    )
  })

  it('holds for the output folder, where a file staying in its format is tagged where it sits', () => {
    expect(batchWritesTagsOnly([wav, mp3], pick({ destination: 'folder' }), quiet)).toBe(true)
  })

  // A destination nobody picked is not the one the selector shows for the open track: the
  // run reads Settings for it, so the label has to as well.
  it('reads the destination from Settings when none was picked by hand', () => {
    const toMusic = { ...base, addToAppleMusic: true }
    expect(batchWritesTagsOnly([wav], pick({ settings: toMusic }), quiet)).toBe(true)
    expect(batchWritesTagsOnly([wav], pick({ settings: base }), quiet)).toBe(true)
    const beside = { ...base, convertBesideOriginal: true }
    expect(batchWritesTagsOnly([wav], pick({ settings: beside }), quiet)).toBe(false)
  })

  // AIFF highlighted because it is the Settings default is not AIFF asked for: with "keep
  // MP3" on, the MP3s stay MP3 and only get their tags.
  it('holds for MP3s the keep setting leaves as they are under a default format', () => {
    const keeps = { ...base, keepMp3Sources: true, overwriteOriginal: true }
    const byDefault = pick({ format: 'aiff', formatByHand: false, settings: keeps })
    expect(batchWritesTagsOnly([mp3], byDefault, quiet)).toBe(true)
    expect(batchWritesTagsOnly([mp3, wav], byDefault, quiet)).toBe(false)
  })

  it('fails for the same MP3s once another format is picked by hand', () => {
    const keeps = { ...base, keepMp3Sources: true, overwriteOriginal: true }
    const byHand = pick({ format: 'wav', formatByHand: true, settings: keeps })
    expect(batchWritesTagsOnly([mp3], byHand, quiet)).toBe(false)
  })

  // A track opened from an Apple Music playlist keeps its own format until a format is
  // picked for it by hand.
  it('holds for Apple Music playlist tracks under a default format, and fails once one is picked', () => {
    const fromMusic = { ...wav, fromAppleMusic: true }
    const over = { ...base, overwriteOriginal: true }
    expect(
      batchWritesTagsOnly(
        [fromMusic],
        pick({ format: 'aiff', formatByHand: false, settings: over }),
        quiet,
      ),
    ).toBe(true)
    expect(
      batchWritesTagsOnly(
        [fromMusic],
        pick({ format: 'aiff', formatByHand: true, settings: over }),
        quiet,
      ),
    ).toBe(false)
  })

  // "Same as source" skips a file with no format of its own to stay in: it is not part of
  // what the run writes, so it does not decide the label.
  it('leaves out a file the run will skip', () => {
    const opus = { ...track('c', 'idle'), inputPath: '/c.opus' }
    expect(batchWritesTagsOnly([wav, opus], pick({ destination: 'overwrite' }), quiet)).toBe(true)
    expect(batchWritesTagsOnly([opus], pick({ destination: 'overwrite' }), quiet)).toBe(false)
  })

  it('fails with nothing to write', () => {
    expect(batchWritesTagsOnly([], pick({ destination: 'overwrite' }), quiet)).toBe(false)
  })
})

// The button names one format only when the run really writes one: a label read off the
// format picked or off Settings promised AIFF over MP3s the keep setting leaves as MP3.
describe('batchFormats', () => {
  const quiet = (): object => ({})
  const base = {
    outputFormat: 'aiff' as const,
    keepMp3Sources: false,
    overwriteOriginal: false,
    convertBesideOriginal: false,
    addToAppleMusic: false,
  }
  const pick = (over: Partial<BatchPick> = {}): BatchPick => ({
    format: 'aiff',
    formatByHand: false,
    settings: base,
    ...over,
  })
  const flacA = { ...track('a', 'idle'), inputPath: '/a.flac' }
  const flacB = { ...track('b', 'idle'), inputPath: '/b.flac' }
  const mp3 = { ...track('m', 'idle'), inputPath: '/m.mp3' }
  const opus = { ...track('o', 'idle'), inputPath: '/o.opus' }

  it('resolves every track to the one format picked', () => {
    expect(batchFormats([flacA, flacB], pick(), quiet)).toEqual(['aiff'])
    expect(batchFormats([flacA, mp3], pick({ format: 'alac', formatByHand: true }), quiet)).toEqual(
      ['alac'],
    )
  })

  it('lists the MP3 the keep setting leaves as it is beside the format the rest take', () => {
    const keeps = { ...base, keepMp3Sources: true }
    expect(batchFormats([mp3, flacA], pick({ settings: keeps }), quiet).sort()).toEqual([
      'aiff',
      'mp3',
    ])
  })

  it('lists each format a mixed selection keeps under Same as source', () => {
    expect(batchFormats([flacA, mp3], pick({ format: 'source' }), quiet).sort()).toEqual([
      'flac',
      'mp3',
    ])
  })

  it('leaves out a track the run skips, so it does not decide the label', () => {
    expect(batchFormats([flacA, opus], pick({ format: 'source' }), quiet)).toEqual(['flac'])
  })

  it('names nothing with nothing to write', () => {
    expect(batchFormats([], pick(), quiet)).toEqual([])
  })
})

// "Same as source" only does something a real format does not when the files differ: over
// two FLACs it is FLAC, a second name for one choice.
describe('offersSourceFormat', () => {
  const flacA = { ...track('a', 'idle'), inputPath: '/a.flac' }
  const flacB = { ...track('b', 'idle'), inputPath: '/b.FLAC' }
  const mp3 = { ...track('m', 'idle'), inputPath: '/m.mp3' }
  const aif = { ...track('c', 'idle'), inputPath: '/c.aif' }
  const aiff = { ...track('d', 'idle'), inputPath: '/d.aiff' }

  it('is held back over files that all share one format', () => {
    expect(offersSourceFormat([flacA, flacB], 'aiff')).toBe(false)
    expect(offersSourceFormat([aif, aiff], 'aiff')).toBe(false)
  })

  // A dot in a folder name is no extension: files without one share a single "format".
  it('reads a file with no extension as one format, whatever its folder is called', () => {
    const bare = { ...track('e', 'idle'), inputPath: '/Mix.2024/intro' }
    const other = { ...track('g', 'idle'), inputPath: '/Set.v2/outro' }
    expect(offersSourceFormat([bare, other], 'aiff')).toBe(false)
  })

  it('is offered once the files have more than one format', () => {
    expect(offersSourceFormat([flacA, mp3], 'aiff')).toBe(true)
  })

  // Settings may already say Same as source: the menu must still show it, checked.
  it('stays offered while it is the format in use', () => {
    expect(offersSourceFormat([flacA, flacB], 'source')).toBe(true)
  })
})

// Ten converted tracks given a new loudness target together must be offered again: the
// batch took them for finished and there was no way to apply the change.
describe('a converted track whose own dial changed', () => {
  const loud = (targetLufs: number) =>
    ({ mode: 'loudness', targetLufs, truePeakDb: -1, peakDb: -1 }) as const
  const redialled = {
    ...track('a', 'done', { title: 'x', artist: 'y' }),
    processedNormalize: loud(-14),
    normalize: loud(-9),
  }
  const untouched = {
    ...track('b', 'done', { title: 'x', artist: 'y' }),
    processedNormalize: loud(-14),
  }

  it('can be converted again from the shortcut', () => {
    expect(canProcessTrack(redialled, [])).toBe(true)
    expect(canProcessTrack(untouched, [])).toBe(false)
  })

  it('enters a batch, and the one left as it was stays out', () => {
    expect(eligibleForBatch([redialled, untouched], [])).toEqual(['a'])
    expect(convertGate([redialled, untouched], []).ready.map((t) => t.id)).toEqual(['a'])
  })
})

// "Clear the list when a batch finishes" takes the finished tracks away. Anything the DJ
// still has to look at or act on must stay: once the row is gone there is nowhere left
// that says it.
describe('leavesListAfterBatch', () => {
  const done = { ...track('a', 'done', { title: 'x' }), outputPath: '/out/a.aiff' }

  it('lets go of a converted track with nothing left to say', () => {
    expect(leavesListAfterBatch(done)).toBe(true)
    expect(leavesListAfterBatch({ ...done, verification: { status: 'ok', checks: [] } })).toBe(true)
  })

  it('keeps a track whose check did not add up, is still running or waits for a DJ app', () => {
    for (const status of ['mismatch', 'checking', 'pending'] as const)
      expect(leavesListAfterBatch({ ...done, verification: { status, checks: [] } })).toBe(false)
  })

  // The row is where "Add to Apple Music" can be tried again.
  it('keeps a track Apple Music refused', () => {
    expect(leavesListAfterBatch({ ...done, musicStatus: 'error' })).toBe(false)
  })

  // A tag fixed while the batch was still running has not been written anywhere yet.
  it('keeps a track edited since it converted', () => {
    expect(leavesListAfterBatch({ ...done, processedSignature: 'before-the-edit' })).toBe(false)
  })

  it('keeps a track that did not finish', () => {
    expect(leavesListAfterBatch(track('b', 'error'))).toBe(false)
    expect(leavesListAfterBatch(track('c', 'idle'))).toBe(false)
  })
})

describe('convertReadiness', () => {
  const tr = i18n.getFixedT('en')
  const ctx = (item: TrackItem, over: Partial<Parameters<typeof convertReadiness>[0]> = {}) => ({
    item,
    isMulti: false,
    resolvedMeta: item.meta,
    requiredFields: ['title', 'artist'],
    multiGate: null,
    againLeftOut: null,
    tr,
    language: 'en',
    ...over,
  })

  // The convert button is disabled while a required field is empty, so the reason has to
  // be readable from the editor itself: the first empty field gets focus and the tooltip
  // names every one.
  it('names the empty required fields of a single track and points at the first', () => {
    const r = convertReadiness(ctx(track('a', 'idle', { title: 'T' })))
    expect(r.incomplete).toBe(true)
    expect(r.firstMissing).toBe('artist')
    expect(r.incompleteReason).toBe('Missing required fields: Artist')
    expect(r.otherSummary).toBe('Missing Artist')
  })

  it('reports a complete single track as ready', () => {
    const r = convertReadiness(ctx(track('a', 'idle', { title: 'T', artist: 'A' })))
    expect(r.incomplete).toBe(false)
    expect(r.firstMissing).toBeUndefined()
    expect(r.incompleteReason).toBeUndefined()
    expect(r.otherSummary).toBeUndefined()
    expect(r.readOnlyReason).toEqual([])
  })

  // A Serato row can't be written back without losing its cues, so it blocks convert on
  // its own even when its tags are complete, and its fields are not asked for.
  it('blocks a read-only program row and skips the missing-field check', () => {
    const item = { ...track('a', 'idle'), programs: ['serato' as const] }
    const r = convertReadiness(ctx(item))
    expect(r.incomplete).toBe(true)
    expect(r.firstMissing).toBeUndefined()
    expect(r.readOnlyReason).toEqual(['Serato would lose the track and its cues'])
    expect(r.incompleteReason).toBe('Serato would lose the track and its cues')
    expect(r.otherSummary).toBeUndefined()
  })

  it('takes the selection gate for a multi selection', () => {
    const tracks = [track('a', 'idle', { title: 'T' }), track('b', 'idle', { title: 'T' })]
    const multiGate = convertGate(tracks, ['title', 'artist'])
    const r = convertReadiness(
      ctx(tracks[0], { isMulti: true, multiGate, againLeftOut: 'two out' }),
    )
    expect(r.incomplete).toBe(true)
    expect(r.firstMissing).toBe('artist')
    expect(r.incompleteReason).toBe('two out')
    expect(r.otherSummary).toBeUndefined()
  })

  it('is not incomplete for a multi selection with nothing left out', () => {
    const r = convertReadiness(ctx(track('a', 'idle'), { isMulti: true, againLeftOut: null }))
    expect(r.incomplete).toBe(false)
    expect(r.incompleteReason).toBeUndefined()
  })

  it('gives no field to fill when the selection mixes replacing and adding', () => {
    const multiGate = { ...convertGate([], ['title']), mixed: true }
    multiGate.missing = { count: 1, fields: ['title'] }
    const r = convertReadiness(ctx(track('a', 'idle'), { isMulti: true, multiGate }))
    expect(r.firstMissing).toBeUndefined()
  })
})
