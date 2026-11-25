import { describe, expect, it } from 'vitest'
import type { LibraryRow, LibraryVerdict } from '../components/LibrarySection'
import type { CopyReach } from '../hooks/useCopyReach'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import { compareCopies } from './bestCopy'
import {
  type CopyCandidate,
  type CopyComparisonContext,
  comparedCopyOf,
  copyComparisonOf,
  copyPathIn,
  countsAsCopy,
  type FillCandidate,
  fillCopyPath,
  keptFormatOf,
  type LibraryCopyOfferContext,
  type LibraryCopyTarget,
  libraryCopyOfferOf,
  libraryTargetOf,
  type MusicCopyContext,
  musicCopyOf,
  type PickedCopyContext,
  pickedCopyOf,
  pickLibraryCopy,
  replaceCopyPatch,
  replaceWarnsFirst,
  versionCopyIn,
  versionCopyPath,
} from './libraryCopy'
import { replacePatch } from './replaceBeforeConvert'

describe('countsAsCopy', () => {
  it.each(['same', 'even', 'tie', 'here', 'library', 'unmeasurable', 'measuring'] as const)(
    'counts every verdict about the same recording as a copy, since the DJ already has that track there (%s)',
    (verdict) => {
      expect(countsAsCopy(verdict)).toBe(true)
    },
  )

  it.each(['different', 'unreadable', 'missing', 'thisFile'] as const)(
    'does not count another version, an unreachable copy or the open file itself (%s)',
    (verdict) => {
      expect(countsAsCopy(verdict)).toBe(false)
    },
  )

  it('does not count several tied copies, since Surco cannot tell which one is the track', () => {
    expect(countsAsCopy('several')).toBe(false)
  })

  it('has no copy before any verdict', () => {
    expect(countsAsCopy(null)).toBe(false)
    expect(countsAsCopy(undefined)).toBe(false)
  })
})

describe('copyPathIn', () => {
  it('finds the copy of one program and ignores the others', () => {
    const rows: {
      program: 'rekordbox' | 'engine'
      path: string
      verdict: LibraryVerdict
      durationSec: number
    }[] = [
      { program: 'rekordbox', path: '/r/a.aiff', verdict: 'same', durationSec: 200 },
      { program: 'engine', path: '/e/a.mp3', verdict: 'different', durationSec: 200 },
    ]
    expect(copyPathIn('rekordbox', rows, 200)).toBe('/r/a.aiff')
    expect(copyPathIn('engine', rows, 200)).toBeUndefined()
  })
})

// «same» can come from the pair probe over the first 91 s alone, which a longer or shorter
// edit cut from the same master passes too, so no verdict is trusted without the lengths.
describe('copyPathIn and the length of the copy', () => {
  const rowOf = (verdict: LibraryVerdict, durationSec?: number) => [
    { program: 'rekordbox' as const, path: '/r/a.aiff', verdict, durationSec },
  ]

  const counted = ['same', 'even', 'tie', 'here', 'library', 'unmeasurable', 'measuring'] as const

  it.each(counted)(
    'does not file another edit in the set, whatever the verdict says (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict, 45), 30)).toBeUndefined()
    },
  )

  it.each(counted)(
    'counts a copy of the same length, so the DJ does not wait for the comparison (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict, 31.5), 30)).toBe('/r/a.aiff')
    },
  )

  it.each(counted)(
    'does not count a copy whose length is unknown on either side, since it may be another edit (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict), 30)).toBeUndefined()
      expect(copyPathIn('rekordbox', rowOf(verdict, 30))).toBeUndefined()
      expect(copyPathIn('rekordbox', rowOf(verdict))).toBeUndefined()
    },
  )

  it('does not count an extended edit the probe called the same recording', () => {
    expect(copyPathIn('rekordbox', rowOf('same', 400), 210)).toBeUndefined()
  })
})

describe('fillCopyPath', () => {
  const rekordbox = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/r/a.aiff',
    verdict,
    durationSec,
  })
  const traktor = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/t/a.wav',
    verdict,
    durationSec,
  })
  const fill = (args: {
    musicCopy?: FillCandidate
    musicCopyPending?: boolean
    programsPending?: boolean
    programs: Parameters<typeof fillCopyPath>[0]['programs']
    fileDurationSec?: number
  }) =>
    fillCopyPath({
      musicCopy: args.musicCopy ?? null,
      musicCopyPending: args.musicCopyPending ?? false,
      programsPending: args.programsPending ?? false,
      programs: args.programs,
      fileDurationSec: args.fileDurationSec,
    })

  const musicCopy = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/m/old.mp3',
    verdict,
    durationSec,
  })

  it('takes the Apple Music copy a replacement supersedes before any DJ copy', () => {
    expect(
      fill({
        musicCopy: musicCopy('library', 200),
        programs: [rekordbox('same', 200)],
        fileDurationSec: 200,
      }),
    ).toBe('/m/old.mp3')
  })

  // The album, year and label are only this file's when the copy is the same recording, in
  // Music as in a DJ program: the 5:57 MP3 in Music against a 6:01 FLAC is another edit.
  it('never fills everything from an Apple Music copy that is another version', () => {
    expect(fill({ musicCopy: musicCopy('here', 357), programs: [], fileDurationSec: 361 })).toBe('')
    expect(
      fill({ musicCopy: musicCopy('different', 361), programs: [], fileDurationSec: 361 }),
    ).toBe('')
  })

  it('fills from a DJ copy of the same recording when the Apple Music copy is another version', () => {
    expect(
      fill({
        musicCopy: musicCopy('different', 357),
        programs: [rekordbox('same', 361)],
        fileDurationSec: 361,
      }),
    ).toBe('/r/a.aiff')
  })

  // Program order decides which copy fills, and a program whose collection is still being
  // read may hold one ahead of the copy found so far.
  it('waits for every DJ collection before filling from a DJ copy', () => {
    expect(
      fill({ programs: [rekordbox('same', 200)], programsPending: true, fileDurationSec: 200 }),
    ).toBe('')
  })

  it('fills from the Apple Music copy without waiting for the DJ collections, it goes first', () => {
    expect(
      fill({
        musicCopy: musicCopy('same', 200),
        programs: [],
        programsPending: true,
        fileDurationSec: 200,
      }),
    ).toBe('/m/old.mp3')
  })

  it('waits while the Apple Music copy is still being compared, it has the say', () => {
    expect(
      fill({
        musicCopy: musicCopy('measuring'),
        programs: [rekordbox('same', 200)],
        fileDurationSec: 200,
      }),
    ).toBe('')
  })

  it('waits while the Apple Music copy is still being located, since it has the say', () => {
    expect(fill({ musicCopyPending: true, programs: [rekordbox('same')] })).toBe('')
  })

  it('takes the first DJ copy of the same recording', () => {
    expect(
      fill({ programs: [rekordbox('here', 200), traktor('same')], fileDurationSec: 200 }),
    ).toBe('/r/a.aiff')
  })

  it.each(['different', 'unreadable', 'missing', 'thisFile', null] as const)(
    'skips copies whose tags belong to another file (%s)',
    (verdict) => {
      expect(
        fill({ programs: [rekordbox(verdict, 200), traktor('same', 200)], fileDurationSec: 200 }),
      ).toBe('/t/a.wav')
    },
  )

  it('never reads a copy still being compared, it may be another version', () => {
    expect(fill({ programs: [rekordbox('measuring', 200)], fileDurationSec: 200 })).toBe('')
  })

  it('waits for the first copy instead of the one that finished comparing first', () => {
    expect(
      fill({ programs: [rekordbox('measuring', 200), traktor('same')], fileDurationSec: 200 }),
    ).toBe('')
  })

  // Its length cannot rule it out yet: the collection may not store it and the measured one
  // may not have landed, and the verdict still to come is what calls it another version.
  it('waits for a first copy still being compared even with its length unknown', () => {
    expect(
      fill({ programs: [rekordbox('measuring'), traktor('same', 200)], fileDurationSec: 200 }),
    ).toBe('')
  })

  // The position decides, not the length: the first copy being compared holds the fill back
  // even when its length already says another edit, until its verdict lands.
  it('waits for a first copy still being compared even when its length is outside the gap', () => {
    expect(
      fill({ programs: [rekordbox('measuring', 400), traktor('same', 200)], fileDurationSec: 200 }),
    ).toBe('')
  })

  it('fills from a copy that could not be measured, the spec counts it as a copy', () => {
    expect(fill({ programs: [rekordbox('unmeasurable', 200)], fileDurationSec: 200 })).toBe(
      '/r/a.aiff',
    )
  })

  it('does not fill from a copy that could not be measured when its length differs or is unknown', () => {
    expect(fill({ programs: [rekordbox('unmeasurable', 400)], fileDurationSec: 200 })).toBe('')
    expect(fill({ programs: [rekordbox('unmeasurable')], fileDurationSec: 200 })).toBe('')
    expect(fill({ programs: [rekordbox('unmeasurable', 200)] })).toBe('')
  })

  it('considers the next program when the first copy does not count for its length', () => {
    expect(
      fill({
        programs: [rekordbox('unmeasurable', 400), traktor('same', 200)],
        fileDurationSec: 200,
      }),
    ).toBe('/t/a.wav')
  })

  // A decided verdict other than «same» can still be another edit: the comparison only calls
  // another version when both lengths are known, and a probe that could not line up says nothing.
  it('does not fill from a copy the open file beats when its length is another edit, and looks at the next program', () => {
    expect(
      fill({ programs: [rekordbox('here', 45), traktor('same', 30)], fileDurationSec: 30 }),
    ).toBe('/t/a.wav')
  })

  it('does not fill from a copy the open file beats when its length is unknown', () => {
    expect(fill({ programs: [rekordbox('here')], fileDurationSec: 200 })).toBe('')
    expect(fill({ programs: [rekordbox('here', 200)] })).toBe('')
  })

  // The probe only lines up the first 91 s, so an extended edit cut from the same master reads
  // «same» too, and its mix name, ISRC or track number are not this file's.
  it('does not fill from an extended edit the probe called the same recording', () => {
    expect(fill({ programs: [rekordbox('same', 400)], fileDurationSec: 210 })).toBe('')
  })

  it('does not fill from a copy called the same recording when either length is unknown', () => {
    expect(fill({ programs: [rekordbox('same')], fileDurationSec: 210 })).toBe('')
    expect(fill({ programs: [rekordbox('same', 210)] })).toBe('')
  })

  it('fills from a copy called the same recording when its length matches the file', () => {
    expect(fill({ programs: [rekordbox('same', 211.5)], fileDurationSec: 210 })).toBe('/r/a.aiff')
  })
})

// The copy the Editor reads only for the grouping and the cover when no copy of the same
// recording fills: another version of the track was filed by the DJ under the same grouping,
// but its album, year or label belong to that other release.
describe('versionCopyPath', () => {
  const rekordbox = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/r/a.mp3',
    verdict,
    durationSec,
  })
  const traktor = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/t/a.wav',
    verdict,
    durationSec,
  })
  const version = (args: {
    musicCopy?: FillCandidate
    musicCopyPending?: boolean
    programsPending?: boolean
    programs: Parameters<typeof versionCopyPath>[0]['programs']
    fileDurationSec?: number
  }) =>
    versionCopyPath({
      musicCopy: args.musicCopy ?? null,
      musicCopyPending: args.musicCopyPending ?? false,
      programsPending: args.programsPending ?? false,
      programs: args.programs,
      fileDurationSec: args.fileDurationSec,
    })

  it('takes a copy the comparison called another version', () => {
    expect(version({ programs: [rekordbox('different', 357)], fileDurationSec: 361 })).toBe(
      '/r/a.mp3',
    )
  })

  // FLAC 6:01 against the MP3 5:57 in rekordbox: a verdict about the same audio, but a length
  // that makes it another edit, which the section shows as «Another version».
  it('takes a copy that counts but whose length is another edit', () => {
    expect(version({ programs: [rekordbox('here', 357)], fileDurationSec: 361 })).toBe('/r/a.mp3')
  })

  it('leaves the fill to a copy of the same recording, whose tags are all this file', () => {
    expect(
      version({
        programs: [rekordbox('different', 357), traktor('same', 361)],
        fileDurationSec: 361,
      }),
    ).toBe('')
    expect(
      version({
        musicCopy: { path: '/m/a.mp3', verdict: 'same', durationSec: 361 },
        programs: [rekordbox('different', 357)],
        fileDurationSec: 361,
      }),
    ).toBe('')
  })

  it('takes the Apple Music copy that is another version before a DJ one', () => {
    expect(
      version({
        musicCopy: { path: '/m/a.mp3', verdict: 'here', durationSec: 357 },
        programs: [rekordbox('different', 357)],
        fileDurationSec: 361,
      }),
    ).toBe('/m/a.mp3')
  })

  it('waits while the Apple Music copy is still being compared', () => {
    expect(
      version({
        musicCopy: { path: '/m/a.mp3', verdict: 'measuring' },
        programs: [rekordbox('different', 357)],
        fileDurationSec: 361,
      }),
    ).toBe('')
  })

  // A copy still compared may yet turn out to be the same recording, which fills everything.
  it('waits while any copy is still being compared', () => {
    expect(
      version({
        programs: [rekordbox('different', 357), traktor('measuring', 361)],
        fileDurationSec: 361,
      }),
    ).toBe('')
  })

  // On first open a fast collection with another version must not spend the track's one fill
  // before rekordbox's master.db, still loading, turns up the same recording.
  it('waits while a DJ collection is still being read, it may hold the same recording', () => {
    expect(
      version({
        programs: [rekordbox('different', 357)],
        programsPending: true,
        fileDurationSec: 361,
      }),
    ).toBe('')
  })

  it('waits while the Apple Music copy is still being located, it may be the same recording', () => {
    expect(
      version({
        musicCopyPending: true,
        programs: [rekordbox('different', 357)],
        fileDurationSec: 361,
      }),
    ).toBe('')
  })

  // With tied copies Surco cannot tell which one is the track, nor which grouping is its own.
  it.each(['several', 'missing', 'unreadable', 'thisFile', null] as const)(
    'lends nothing from a copy that is not known to be another version (%s)',
    (verdict) => {
      expect(version({ programs: [rekordbox(verdict, 357)], fileDurationSec: 361 })).toBe('')
    },
  )

  it('lends nothing from a counted copy whose length is unknown, nothing says another edit', () => {
    expect(version({ programs: [rekordbox('here')], fileDurationSec: 361 })).toBe('')
    expect(version({ programs: [rekordbox('here', 357)] })).toBe('')
  })
})

// Each program's playlists field stages the playlists of that program's own copy, so the
// rule looks at one program's rows at a time.
describe('versionCopyIn', () => {
  const row = (
    program: 'rekordbox' | 'traktor',
    verdict: LibraryVerdict | null,
    durationSec?: number,
    path = `/${program}/a.mp3`,
  ) => ({ program, path, verdict, durationSec })

  it("takes the program's copy that is another version", () => {
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'different', 357)], 361, false)).toBe(
      '/rekordbox/a.mp3',
    )
  })

  it('takes a copy whose length alone says it is another version', () => {
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'same', 30)], 95, false)).toBe(
      '/rekordbox/a.mp3',
    )
  })

  it("ignores another program's copy, whose playlists belong to that program", () => {
    expect(versionCopyIn('rekordbox', [row('traktor', 'different', 30)], 95, false)).toBe('')
  })

  // That copy is the track: the field acts on it at once and nothing is staged.
  it('takes nothing when the program also holds a copy of the same recording', () => {
    const rows = [
      row('rekordbox', 'different', 30, '/r/edit.mp3'),
      row('rekordbox', 'same', 95, '/r/a.wav'),
    ]
    expect(versionCopyIn('rekordbox', rows, 95, false)).toBe('')
  })

  // A copy still compared may prove to be the same recording, which the field acts on instead.
  it('waits while a copy of the program is still being compared', () => {
    const rows = [
      row('rekordbox', 'different', 30, '/r/edit.mp3'),
      row('rekordbox', 'measuring', undefined, '/r/a.wav'),
    ]
    expect(versionCopyIn('rekordbox', rows, 95, false)).toBe('')
  })

  it('waits while a DJ collection is still being read', () => {
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'different', 30)], 95, true)).toBe('')
  })

  it('takes no copy that is missing or unreadable, whose playlists may be stale', () => {
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'missing', 30)], 95, false)).toBe('')
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'unreadable', 30)], 95, false)).toBe('')
  })

  it('takes no copy whose length is unknown, since nothing then tells it apart', () => {
    expect(versionCopyIn('rekordbox', [row('rekordbox', 'same')], 95, false)).toBe('')
  })
})

const music: CopyCandidate = {
  program: 'appleMusic',
  path: '/m/a.mp3',
  format: 'MP3 320',
  verdict: 'same',
  better: true,
  durationSec: 210,
  music: { persistentId: 'PID1', label: 'Artist - Title', path: '/m/a.mp3' },
}
const rekordbox: CopyCandidate = {
  program: 'rekordbox',
  path: '/r/a.aiff',
  format: 'AIFF 16/44.1',
  verdict: 'same',
  better: false,
  durationSec: 210,
}
const traktor: CopyCandidate = { ...rekordbox, program: 'traktor', path: '/t/a.aiff' }

describe('pickLibraryCopy', () => {
  // Apple Music leads the section, and its copy is the one the convert can update in place.
  it('takes the Apple Music copy before any DJ copy', () => {
    expect(pickLibraryCopy([music, rekordbox], 210)).toMatchObject({
      program: 'appleMusic',
      path: '/m/a.mp3',
      held: false,
    })
  })

  it('takes the first DJ copy that counts, in the order of the section', () => {
    expect(pickLibraryCopy([{ ...rekordbox, verdict: 'different' }, traktor], 210)).toMatchObject({
      program: 'traktor',
      path: '/t/a.aiff',
      held: false,
    })
  })

  it.each(['different', 'unreadable', 'missing', 'thisFile', 'several', null] as const)(
    'offers nothing for a lone copy that is %s',
    (verdict) => {
      expect(pickLibraryCopy([{ ...rekordbox, verdict }], 210)).toBeNull()
    },
  )

  // «same» can come from the 91 s pair probe, which a longer edit of the same master passes
  // too: updating that copy would overwrite another version of the track.
  it('offers nothing for a copy whose length is another edit, whatever its verdict', () => {
    expect(pickLibraryCopy([{ ...rekordbox, durationSec: 400 }], 210)).toBeNull()
  })

  it('offers nothing while either length is unknown', () => {
    expect(pickLibraryCopy([{ ...rekordbox, durationSec: undefined }], 210)).toBeNull()
    expect(pickLibraryCopy([rekordbox], undefined)).toBeNull()
  })

  it('holds the press while the copy is still being compared, it may be another version', () => {
    expect(pickLibraryCopy([{ ...rekordbox, verdict: 'measuring' }], 210)).toMatchObject({
      program: 'rekordbox',
      held: true,
    })
  })

  it('holds the press while Apple Music has not said where its copy lives', () => {
    expect(pickLibraryCopy([{ ...music, path: '' }], 210)).toMatchObject({
      program: 'appleMusic',
      held: true,
    })
  })

  // A copy Surco just added to Traktor is measured for about a second before its length is
  // known: dropping it meanwhile made the body say Convert, and a press added a duplicate.
  it('holds a copy still being measured whose length is not known yet', () => {
    expect(
      pickLibraryCopy([{ ...traktor, verdict: 'measuring', durationSec: undefined }], 210),
    ).toMatchObject({ program: 'traktor', path: '/t/a.aiff', held: true })
  })

  it('holds the Apple Music copy whose path and length are both still unknown', () => {
    expect(pickLibraryCopy([{ ...music, path: '', durationSec: undefined }], 210)).toMatchObject({
      program: 'appleMusic',
      held: true,
    })
  })

  // Once measured, the length rule decides again: another edit is not this file's copy.
  it('offers nothing for a measuring copy whose length turned out to be another edit', () => {
    expect(
      pickLibraryCopy([{ ...traktor, verdict: 'measuring', durationSec: 400 }], 210),
    ).toBeNull()
  })
})

describe('replaceCopyPatch', () => {
  it('replaces a DJ copy by its path alone, Apple Music is not involved', () => {
    const target = pickLibraryCopy([rekordbox], 210)
    if (!target) throw new Error('expected a copy')
    expect(replaceCopyPatch(target, '/open/a.wav')).toEqual({ replacesPath: '/r/a.aiff' })
  })

  it('clears a replacement already carried out so a new Replace on a DJ copy is sent', () => {
    const target = pickLibraryCopy([rekordbox], 210)
    if (!target) throw new Error('expected a copy')
    const replacedBefore = { replacesPath: '/r/old.aiff', replaceDone: true as const }
    const stamped = { ...replacedBefore, ...replaceCopyPatch(target, '/open/a.wav') }
    expect(stamped.replacesPath).toBe('/r/a.aiff')
    expect(stamped.replaceDone).toBeUndefined()
  })

  it('replaces the Apple Music copy with the stamp it has today', () => {
    const target = pickLibraryCopy([music], 210)
    if (!target) throw new Error('expected a copy')
    expect(replaceCopyPatch(target, '/open/a.wav')).toEqual(
      replacePatch(music.music ?? null, '/open/a.wav'),
    )
  })
})

describe('keptFormatOf', () => {
  it('keeps an .aif copy as AIFF and an .m4a copy as its own container', () => {
    expect(keptFormatOf('/r/a.aif')).toBe('aiff')
    expect(keptFormatOf('/m/a.m4a')).toBe('alac')
    expect(keptFormatOf('/x/a.ogg')).toBeUndefined()
  })
})

// A menu Replace runs at once only when it is known to cost no stars: on a Serato copy whose
// collection is not read yet, the first Replace would go through before the warning could show.
describe('replaceWarnsFirst', () => {
  it('holds a Replace on a Serato copy while the stars loss is unknown', () => {
    expect(replaceWarnsFirst('serato', undefined)).toBe(true)
  })

  it('holds a Replace that is known to cost stars, whatever the program', () => {
    expect(replaceWarnsFirst('rekordbox', true)).toBe(true)
    expect(replaceWarnsFirst('serato', true)).toBe(true)
  })

  it('runs a Replace known to cost nothing, or unknown on a copy Serato did not hand over', () => {
    expect(replaceWarnsFirst('serato', false)).toBe(false)
    expect(replaceWarnsFirst('rekordbox', undefined)).toBe(false)
  })
})

describe('comparedCopyOf', () => {
  it('compares the library copy when it is another file than the open one', () => {
    expect(
      comparedCopyOf({ libraryCopyPath: '/m/a.mp3', inputPath: '/in/a.wav', isMulti: false }),
    ).toEqual({ comparedCopyPath: '/m/a.mp3', musicHoldsFile: false })
  })

  // A track opened from the library's own folder is that copy: measuring it against itself
  // would only ever say «same».
  it('compares nothing when the open file is the library copy, which Music then holds', () => {
    expect(
      comparedCopyOf({ libraryCopyPath: '/m/A.mp3', inputPath: '/m/a.mp3', isMulti: false }),
    ).toEqual({ comparedCopyPath: '', musicHoldsFile: true })
  })

  it('compares nothing for a selection, whose tracks each have their own copy', () => {
    expect(
      comparedCopyOf({ libraryCopyPath: '/m/a.mp3', inputPath: '/in/a.wav', isMulti: true }),
    ).toEqual({ comparedCopyPath: '', musicHoldsFile: false })
  })

  it('has Music hold nothing while it has no copy at all', () => {
    expect(
      comparedCopyOf({ libraryCopyPath: '', inputPath: '', isMulti: false }).musicHoldsFile,
    ).toBe(false)
  })
})

describe('copyComparisonOf', () => {
  const reach = (over: Partial<CopyReach> = {}): CopyReach => ({
    missing: false,
    unreadable: false,
    checking: false,
    ...over,
  })
  const base: CopyComparisonContext = {
    musicCopyReach: undefined,
    hereFacts: { ext: 'WAV' },
    libraryFacts: { ext: 'MP3' },
    copyPair: null,
    comparedCopyPath: '/m/a.mp3',
    copyOpenFor: '',
    inputPath: '/in/a.wav',
    libraryCopyPath: '/m/a.mp3',
    spectrumInHand: undefined,
    replacedCopySpectrum: undefined,
  }

  it('compares the two copies once every fact is in', () => {
    const c = copyComparisonOf(base)
    expect(c.copyVerdict).toEqual(compareCopies({ ext: 'WAV' }, { ext: 'MP3' }, null))
    expect(c.copyVerdict?.winner).toBe('a')
    expect(c.copyMeasuring).toBe(false)
    expect(c.libraryCopyBetter).toBe(false)
  })

  it.each([
    ['this file', { hereFacts: undefined }],
    ['the library copy', { libraryFacts: undefined }],
    ['the pair probe', { copyPair: undefined }],
  ] as const)('is still measuring while the facts of %s are missing', (_, over) => {
    const c = copyComparisonOf({ ...base, ...over })
    expect(c.copyVerdict).toBeNull()
    expect(c.copyMeasuring).toBe(true)
  })

  it('measures nothing when there is no copy to compare', () => {
    expect(
      copyComparisonOf({ ...base, comparedCopyPath: '', hereFacts: undefined }).copyMeasuring,
    ).toBe(false)
  })

  it('says the library copy is better when the comparison makes it the winner', () => {
    expect(
      copyComparisonOf({ ...base, hereFacts: { ext: 'MP3' }, libraryFacts: { ext: 'WAV' } })
        .libraryCopyBetter,
    ).toBe(true)
  })

  // Until the comparison answers, the format and cutoff check still tells a WAV in the
  // library from an MP3 in hand, so the row does not wait to warn.
  it('falls back on the format and cutoff check while the comparison has no verdict', () => {
    const waiting = { ...base, hereFacts: undefined }
    expect(
      copyComparisonOf({ ...waiting, libraryCopyPath: '/m/a.wav', inputPath: '/in/a.mp3' })
        .libraryCopyBetter,
    ).toBe(true)
    expect(copyComparisonOf(waiting).libraryCopyBetter).toBe(false)
    expect(
      copyComparisonOf({
        ...waiting,
        libraryCopyPath: '/m/a.mp3',
        inputPath: '/in/b.mp3',
        replacedCopySpectrum: { cutoffHz: 20000, hasKnee: false },
        spectrumInHand: { cutoffHz: 16000, hasKnee: false },
      }).libraryCopyBetter,
    ).toBe(true)
    expect(
      copyComparisonOf({ ...waiting, libraryCopyPath: '', inputPath: '/in/a.mp3' })
        .libraryCopyBetter,
    ).toBe(false)
  })

  it('takes the copy as unreached when it is missing or unreadable', () => {
    expect(copyComparisonOf(base).musicCopyUnreached).toBe(false)
    expect(copyComparisonOf({ ...base, musicCopyReach: reach() }).musicCopyUnreached).toBe(false)
    expect(
      copyComparisonOf({ ...base, musicCopyReach: reach({ missing: true }) }).musicCopyUnreached,
    ).toBe(true)
    expect(
      copyComparisonOf({ ...base, musicCopyReach: reach({ unreadable: true }) }).musicCopyUnreached,
    ).toBe(true)
  })

  // The open state is keyed on the pair, so a comparison opened on one track does not stay
  // open on the next one, and one that has nothing to say never opens.
  it('opens the comparison only for the pair it was opened on, with copies that differ', () => {
    const openedHere = { ...base, copyOpenFor: '/in/a.wav\n/m/a.mp3' }
    expect(copyComparisonOf(openedHere).copyOpen).toBe(true)
    expect(copyComparisonOf(base).copyOpen).toBe(false)
    expect(copyComparisonOf({ ...openedHere, inputPath: '/in/b.wav' }).copyOpen).toBe(false)
    expect(copyComparisonOf({ ...openedHere, hereFacts: undefined }).copyOpen).toBe(false)
  })

  it('never opens the comparison of two copies with the same audio', () => {
    const same = { ...base, hereFacts: { ext: 'WAV' }, libraryFacts: { ext: 'WAV' } }
    const pair = { correlation: 1, residualDb: Number.NEGATIVE_INFINITY, gainDb: 0 }
    const opened = { ...same, copyPair: pair, copyOpenFor: '/in/a.wav\n/m/a.mp3' }
    expect(copyComparisonOf(opened).copyVerdict).toEqual({ winner: 'same' })
    expect(copyComparisonOf(opened).copyOpen).toBe(false)
  })

  it('builds a new verdict on every call, as the render did', () => {
    expect(copyComparisonOf(base).copyVerdict).not.toBe(copyComparisonOf(base).copyVerdict)
  })
})

const musicTarget = { persistentId: 'PID1', label: 'Artist - Title', path: '/m/a.mp3' }
const musicRowOf = (durationSec?: number): LibraryRow => ({
  id: 'appleMusic',
  name: 'Apple Music',
  format: 'MP3 320',
  comparable: true,
  verdict: 'same',
  durationSec,
  comparisonOpen: false,
  onToggleComparison: () => {},
})

describe('musicCopyOf', () => {
  const base: MusicCopyContext = {
    replaceTarget: musicTarget,
    musicRow: musicRowOf(210),
    replacedCopyFormat: 'MP3 320',
    libraryCopyBetter: true,
    musicEntryDurationSec: 200,
  }

  it('offers the Music copy with its row verdict, its format and its own entry', () => {
    const { musicCopy } = musicCopyOf(base)
    expect(musicCopy).toEqual({
      program: 'appleMusic',
      path: '/m/a.mp3',
      format: 'MP3 320',
      verdict: 'same',
      better: true,
      durationSec: 210,
      music: musicTarget,
    })
    expect(musicCopy?.music).toBe(musicTarget)
  })

  // Without a measured length the Music copy would drop out and let a DJ copy act in its
  // place, so Music's own length stands in.
  it('takes the length Music gives while the row has none measured', () => {
    expect(musicCopyOf({ ...base, musicRow: musicRowOf() }).musicCopy?.durationSec).toBe(200)
  })

  it('has an empty path while Music has not said where the copy lives', () => {
    expect(
      musicCopyOf({ ...base, replaceTarget: { persistentId: 'PID1', label: 'x' } }).musicCopy?.path,
    ).toBe('')
  })

  it('offers no Music copy for an ambiguous match, without a target or without its row', () => {
    expect(musicCopyOf({ ...base, replaceTarget: { ambiguous: ['A', 'B'] } }).musicCopy).toBeNull()
    expect(musicCopyOf({ ...base, replaceTarget: null }).musicCopy).toBeNull()
    expect(musicCopyOf({ ...base, musicRow: null }).musicCopy).toBeNull()
  })
})

describe('pickedCopyOf', () => {
  const musicCopy = musicCopyOf({
    replaceTarget: musicTarget,
    musicRow: musicRowOf(210),
    replacedCopyFormat: 'MP3 320',
    libraryCopyBetter: false,
    musicEntryDurationSec: undefined,
  }).musicCopy
  const state = (over: Partial<CopyVerdictState> = {}): CopyVerdictState => ({
    verdict: { winner: 'b', reason: 'lossless' },
    measuring: false,
    format: 'AIFF 16/44.1',
    missing: false,
    unreadable: false,
    checking: false,
    ...over,
  })
  const base: PickedCopyContext = {
    isMulti: false,
    musicCopy: null,
    musicHoldsFile: false,
    comparedProgramCopies: [{ program: 'rekordbox', path: '/r/a.aiff', isThisFile: false }],
    programVerdicts: [state()],
    copyRows: [{ program: 'rekordbox', path: '/r/a.aiff', verdict: 'library', durationSec: 210 }],
    fileDurationSec: 210,
  }

  it('picks a DJ copy with the format, verdict and length of its row', () => {
    expect(pickedCopyOf(base).pickedCopy).toEqual({
      program: 'rekordbox',
      path: '/r/a.aiff',
      format: 'AIFF 16/44.1',
      better: true,
      durationSec: 210,
      held: false,
    })
  })

  it('says a DJ copy is better only when its verdict makes the library the winner', () => {
    expect(
      pickedCopyOf({ ...base, programVerdicts: [state({ verdict: { winner: 'same' } })] })
        .pickedCopy?.better,
    ).toBe(false)
  })

  // Replacing puts this file in Music's place, so its copy is the one the user sees as the
  // track, ahead of any DJ copy.
  it('picks the Music copy before any DJ copy', () => {
    expect(pickedCopyOf({ ...base, musicCopy }).pickedCopy?.program).toBe('appleMusic')
  })

  it('leaves the Music copy out when Music holds the open file itself', () => {
    expect(pickedCopyOf({ ...base, musicCopy, musicHoldsFile: true }).pickedCopy?.program).toBe(
      'rekordbox',
    )
  })

  it('picks nothing for a selection', () => {
    expect(pickedCopyOf({ ...base, musicCopy, isMulti: true }).pickedCopy).toBeNull()
  })

  it('picks no copy whose length is another edit', () => {
    expect(pickedCopyOf({ ...base, fileDurationSec: 400 }).pickedCopy).toBeNull()
  })
})

describe('libraryTargetOf', () => {
  const picked = pickLibraryCopy([rekordbox], 210)

  it('acts on the picked copy with the format it keeps', () => {
    const { libraryTarget, keptFormat } = libraryTargetOf({
      pickedCopy: picked,
      pickedIsThisFile: false,
    })
    expect(libraryTarget).toEqual(picked)
    expect(libraryTarget).not.toBe(picked)
    expect(keptFormat).toBe('aiff')
  })

  // Through a symlinked folder the copy may be the open file: acting on it would update or
  // replace the very file, so the press waits until main answers.
  it('holds the press until main says whether the copy is the open file', () => {
    expect(
      libraryTargetOf({ pickedCopy: picked, pickedIsThisFile: undefined }).libraryTarget?.held,
    ).toBe(true)
  })

  it('keeps a copy held when it already was', () => {
    expect(
      libraryTargetOf({ pickedCopy: picked && { ...picked, held: true }, pickedIsThisFile: false })
        .libraryTarget?.held,
    ).toBe(true)
  })

  it('acts on nothing when the copy is the open file or there is none', () => {
    expect(libraryTargetOf({ pickedCopy: picked, pickedIsThisFile: true })).toEqual({
      libraryTarget: null,
      keptFormat: undefined,
    })
    expect(libraryTargetOf({ pickedCopy: null, pickedIsThisFile: false }).libraryTarget).toBeNull()
  })

  it('keeps no format for a copy in one Surco does not write', () => {
    const ogg = pickLibraryCopy([{ ...rekordbox, path: '/r/a.ogg' }], 210)
    expect(libraryTargetOf({ pickedCopy: ogg, pickedIsThisFile: false }).keptFormat).toBeUndefined()
  })
})

describe('libraryCopyOfferOf', () => {
  const target = (over: Partial<LibraryCopyTarget> = {}): LibraryCopyTarget => ({
    program: 'rekordbox',
    path: '/r/a.aiff',
    format: 'AIFF 16/44.1',
    better: true,
    durationSec: 210,
    held: false,
    ...over,
  })
  const base: LibraryCopyOfferContext = {
    libraryTarget: target(),
    keptFormat: 'aiff',
    replaceStarsLoss: false,
    libraryCopyAction: 'update',
  }

  it('offers the chosen action on the copy, named after its program', () => {
    expect(libraryCopyOfferOf(base)).toEqual({
      copyAction: 'update',
      libraryCopy: {
        name: 'rekordbox',
        format: 'AIFF 16/44.1',
        action: 'update',
        better: true,
        held: false,
        keptFormat: 'aiff',
        updatable: true,
        replaceLosesStars: false,
      },
    })
  })

  it('names the Apple Music copy after Apple Music', () => {
    expect(
      libraryCopyOfferOf({ ...base, libraryTarget: target({ program: 'appleMusic' }) }).libraryCopy
        ?.name,
    ).toBe('Apple Music')
  })

  // Offering nothing for a copy Surco can't retag let the body say Convert and add a second
  // entry beside it: the copy is still the track, so it is replaced.
  it('replaces a copy in a format Surco does not write, whatever action was chosen', () => {
    const offer = libraryCopyOfferOf({
      ...base,
      libraryTarget: target({ path: '/r/a.ogg' }),
      keptFormat: undefined,
    })
    expect(offer.copyAction).toBe('replace')
    expect(offer.libraryCopy).toMatchObject({ action: 'replace', updatable: false })
  })

  it('keeps the chosen action for an Apple Music copy with no path yet to judge', () => {
    expect(
      libraryCopyOfferOf({
        ...base,
        libraryTarget: target({ program: 'appleMusic', path: '' }),
        keptFormat: undefined,
      }).copyAction,
    ).toBe('update')
  })

  it('warns that replacing loses Serato stars until the collection says otherwise', () => {
    const serato = { ...base, libraryTarget: target({ program: 'serato' }) }
    expect(
      libraryCopyOfferOf({ ...serato, replaceStarsLoss: undefined }).libraryCopy?.replaceLosesStars,
    ).toBe(true)
    expect(libraryCopyOfferOf(serato).libraryCopy?.replaceLosesStars).toBe(false)
    expect(
      libraryCopyOfferOf({ ...base, replaceStarsLoss: true }).libraryCopy?.replaceLosesStars,
    ).toBe(true)
  })

  it('offers nothing without a copy, and keeps the chosen action', () => {
    expect(
      libraryCopyOfferOf({
        ...base,
        libraryTarget: null,
        keptFormat: undefined,
        libraryCopyAction: 'replace',
      }),
    ).toEqual({ copyAction: 'replace', libraryCopy: undefined })
  })
})
