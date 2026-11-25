import { describe, expect, it } from 'vitest'
import { DEFAULT_DECLICK } from '../../../shared/declick'
import type { NormalizeConfig, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  DESTINATIONS,
  type ExportDestinationContext,
  exportDestination,
  exportReadiness,
  fromDestination,
  toDestination,
} from './destination'
import { trackSignature } from './dirty'

describe('toDestination', () => {
  it('reads the stored booleans back as the single radio choice', () => {
    expect(toDestination(false, false, false)).toBe('folder')
    expect(toDestination(true, false, false)).toBe('appleMusic')
    expect(toDestination(false, false, false, true)).toBe('beside')
  })

  // FLAC can't be added to Apple Music, so the choice falls back to the always-valid
  // output folder regardless of what the booleans say.
  it('pins to the output folder while FLAC is the format', () => {
    expect(toDestination(true, true, false)).toBe('folder')
  })

  // Overwrite is its own axis (it rewrites the source in place), so it wins over every
  // other flag — including the FLAC pin and any library booleans left set.
  it('reports overwrite whenever the flag is set, regardless of the other booleans', () => {
    expect(toDestination(false, false, true)).toBe('overwrite')
    expect(toDestination(true, true, true, true)).toBe('overwrite')
  })

  // Beside-original writes a fresh file next to the source, so it is FLAC-proof — the
  // pin to the output folder must not eat the choice.
  it('keeps beside-original while FLAC is the format', () => {
    expect(toDestination(false, true, false, true)).toBe('beside')
  })
})

describe('fromDestination', () => {
  it('maps each choice onto the stored booleans', () => {
    expect(fromDestination('folder')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      convertBesideOriginal: false,
    })
    expect(fromDestination('appleMusic')).toEqual({
      addToAppleMusic: true,
      keepOutputCopy: false,
      overwriteOriginal: false,
      convertBesideOriginal: false,
    })
  })

  it('picking a destination never turns Engine off', () => {
    for (const d of DESTINATIONS) expect(fromDestination(d)).not.toHaveProperty('addToEngineDj')
  })

  // Overwrite leaves nothing in the output folder and adds nothing to any library: the
  // source file itself is rewritten, so the library booleans are cleared.
  it('clears the library booleans and sets the overwrite flag for overwrite', () => {
    expect(fromDestination('overwrite')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
      convertBesideOriginal: false,
    })
  })

  // Beside-original is the non-destructive sibling of overwrite: a fresh copy next to
  // the source, nothing added to any library, the original never touched.
  it('sets only the beside flag for beside', () => {
    expect(fromDestination('beside')).toEqual({
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      convertBesideOriginal: true,
    })
  })

  // Round-tripping any choice through both functions must return it unchanged, which is
  // what guarantees Settings and the wizard never drift apart.
  it('round-trips every choice', () => {
    for (const d of DESTINATIONS) {
      const { addToAppleMusic, overwriteOriginal, convertBesideOriginal } = fromDestination(d)
      expect(toDestination(addToAppleMusic, false, overwriteOriginal, convertBesideOriginal)).toBe(
        d,
      )
    }
  })
})

function track(inputPath: string, over: Partial<TrackItem> = {}): TrackItem {
  const meta: TrackMetadata = {
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
  }
  return {
    id: 'a',
    inputPath,
    fileName: 'a',
    listLabel: 'a',
    query: '',
    status: 'idle',
    meta,
    ...over,
  }
}

const NO_NORMALIZE: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

describe('exportDestination', () => {
  const ctx = (over: Partial<ExportDestinationContext> = {}): ExportDestinationContext => ({
    item: track('/music/a.wav'),
    isMulti: false,
    picked: fromDestination('folder'),
    format: 'aiff',
    normalizeCfg: NO_NORMALIZE,
    declickCfg: DEFAULT_DECLICK,
    normalize: NO_NORMALIZE,
    declick: DEFAULT_DECLICK,
    destinationPicked: false,
    destination: 'folder',
    addToAppleMusic: false,
    formatPick: 'aiff',
    overwriteOriginal: false,
    convertBesideOriginal: false,
    macOS: true,
    ...over,
  })

  // Exporting to the source's own format rewrites the original and renames it, so the
  // warning has to appear before the click, and only when no copy is made beside it.
  it('warns of an in-place edit only when the format is the source one and no copy is made', () => {
    const inPlace = exportDestination(
      ctx({ item: track('/music/a.wav'), format: 'wav', picked: fromDestination('overwrite') }),
    )
    expect(inPlace.willEditInPlace).toBe(true)
    expect(inPlace.inSourceFolder).toBe(true)
    const beside = exportDestination(
      ctx({ item: track('/music/a.wav'), format: 'wav', picked: fromDestination('beside') }),
    )
    expect(beside.willEditInPlace).toBe(false)
    expect(beside.inSourceFolder).toBe(true)
    const folder = exportDestination(ctx({ format: 'aiff' }))
    expect(folder.willEditInPlace).toBe(false)
    expect(folder.inSourceFolder).toBe(false)
  })

  it('flags only a lossless master overwritten with mp3 as lossy', () => {
    const picked = fromDestination('overwrite')
    expect(exportDestination(ctx({ picked, format: 'mp3' })).lossyOverwrite).toBe(true)
    expect(
      exportDestination(ctx({ picked, format: 'mp3', item: track('/music/a.mp3') })).lossyOverwrite,
    ).toBe(false)
    expect(exportDestination(ctx({ picked, format: 'wav' })).lossyOverwrite).toBe(false)
    expect(exportDestination(ctx({ format: 'mp3' })).lossyOverwrite).toBe(false)
  })

  it('exports only tags for one track already in the target format and never for a selection', () => {
    expect(
      exportDestination(ctx({ format: 'wav', item: track('/music/a.wav') })).tagsOnlyExport,
    ).toBe(true)
    expect(exportDestination(ctx({ format: 'aiff' })).tagsOnlyExport).toBe(false)
    expect(
      exportDestination(ctx({ format: 'wav', item: track('/music/a.wav'), isMulti: true }))
        .tagsOnlyExport,
    ).toBe(false)
  })

  // A batch without a hand-picked destination goes where Settings say, which is not always
  // where the open track goes; Apple Music only counts on macOS.
  it('uses the hand pick for a batch and otherwise reads the Settings', () => {
    expect(
      exportDestination(ctx({ destinationPicked: true, destination: 'beside' })).batchDestination,
    ).toBe('beside')
    expect(exportDestination(ctx({ addToAppleMusic: true, macOS: true })).batchDestination).toBe(
      'appleMusic',
    )
    expect(exportDestination(ctx({ addToAppleMusic: true, macOS: false })).batchDestination).toBe(
      'folder',
    )
    expect(
      exportDestination(ctx({ addToAppleMusic: true, formatPick: 'flac' })).batchDestination,
    ).toBe('folder')
    expect(
      exportDestination(ctx({ overwriteOriginal: true, convertBesideOriginal: true }))
        .batchDestination,
    ).toBe('overwrite')
  })
})

function onDisk(over: Partial<TrackItem> = {}): TrackItem {
  const read = track('/music/a.wav')
  return { ...read, diskSignature: trackSignature(read), fillSignature: 'filled', ...over }
}

describe('exportReadiness', () => {
  const ctx = (over: Partial<Parameters<typeof exportReadiness>[0]> = {}) => ({
    item: onDisk(),
    isMulti: false,
    picked: fromDestination('overwrite'),
    format: 'wav' as const,
    inLibrary: 'yes' as const,
    willEditInPlace: true,
    tagsOnlyExport: true,
    defaultOutputName: 'a',
    incomplete: false,
    batchAddsToMusic: false,
    batchTagsOnly: true,
    selectionHeld: true,
    ...over,
  })

  it('adds to Music only when an in-place edit of a file Music lacks would land there', () => {
    const base = ctx({
      picked: { ...fromDestination('folder'), addToAppleMusic: true },
      inLibrary: 'no',
    })
    expect(exportReadiness(base).addsToMusic).toBe(true)
    expect(exportReadiness({ ...base, inLibrary: 'yes' }).addsToMusic).toBe(false)
    expect(exportReadiness({ ...base, willEditInPlace: false }).addsToMusic).toBe(false)
    expect(exportReadiness({ ...base, format: 'aiff' }).addsToMusic).toBe(false)
    expect(
      exportReadiness({ ...base, item: { ...base.item, fromAppleMusic: true } }).addsToMusic,
    ).toBe(false)
    expect(exportReadiness({ ...base, isMulti: true }).addsToMusic).toBe(false)
  })

  // The footer goes quiet only when running would write nothing: the file already holds
  // the tags, nothing would be added to Music and no required field is empty.
  it('is up to date for one track whose file already holds it', () => {
    expect(exportReadiness(ctx()).upToDate).toBe(true)
    expect(exportReadiness(ctx({ incomplete: true })).upToDate).toBe(false)
    expect(exportReadiness(ctx({ tagsOnlyExport: false })).upToDate).toBe(false)
    expect(exportReadiness(ctx({ willEditInPlace: false })).upToDate).toBe(false)
    expect(
      exportReadiness(
        ctx({ item: track('/music/a.wav', { diskSignature: 's', fillSignature: 's' }) }),
      ).upToDate,
    ).toBe(false)
  })

  it('is up to date for a selection by the batch memos, not by the open track', () => {
    const multi = ctx({ isMulti: true, tagsOnlyExport: false, willEditInPlace: false })
    expect(exportReadiness(multi).upToDate).toBe(true)
    expect(exportReadiness({ ...multi, batchAddsToMusic: true }).upToDate).toBe(false)
    expect(exportReadiness({ ...multi, incomplete: true }).upToDate).toBe(false)
    expect(exportReadiness({ ...multi, batchTagsOnly: false }).upToDate).toBe(false)
    expect(exportReadiness({ ...multi, selectionHeld: false }).upToDate).toBe(false)
  })
})
