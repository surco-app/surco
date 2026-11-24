import { describe, expect, it } from 'vitest'
import type { LibraryVerdict } from '../components/LibrarySection'
import {
  type CopyCandidate,
  copyPathIn,
  countsAsCopy,
  fillCopyPath,
  keptFormatOf,
  pickLibraryCopy,
  replaceCopyPatch,
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
    musicCopyPath?: string
    musicCopyPending?: boolean
    programs: Parameters<typeof fillCopyPath>[0]['programs']
    fileDurationSec?: number
  }) =>
    fillCopyPath({
      musicCopyPath: args.musicCopyPath ?? '',
      musicCopyPending: args.musicCopyPending ?? false,
      programs: args.programs,
      fileDurationSec: args.fileDurationSec,
    })

  it('takes the Apple Music copy a replacement supersedes before any DJ copy', () => {
    expect(fill({ musicCopyPath: '/m/old.mp3', programs: [rekordbox('same')] })).toBe('/m/old.mp3')
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
