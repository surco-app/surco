import { describe, expect, it } from 'vitest'
import type { LibraryVerdict } from '../components/LibrarySection'
import { copyPathIn, countsAsCopy, fillCopyPath } from './libraryCopy'

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
    const rows: { program: 'rekordbox' | 'engine'; path: string; verdict: LibraryVerdict }[] = [
      { program: 'rekordbox', path: '/r/a.aiff', verdict: 'same' },
      { program: 'engine', path: '/e/a.mp3', verdict: 'different' },
    ]
    expect(copyPathIn('rekordbox', rows)).toBe('/r/a.aiff')
    expect(copyPathIn('engine', rows)).toBeUndefined()
  })
})

describe('copyPathIn while the verdict cannot tell the length apart', () => {
  const rowOf = (verdict: LibraryVerdict, durationSec?: number) => [
    { program: 'rekordbox' as const, path: '/r/a.aiff', verdict, durationSec },
  ]

  it.each(['measuring', 'unmeasurable'] as const)(
    'does not file another edit in the set before the verdict can say so (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict, 45), 30)).toBeUndefined()
    },
  )

  it.each(['measuring', 'unmeasurable'] as const)(
    'counts a copy of the same length at once, so the DJ does not wait for the comparison (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict, 31.5), 30)).toBe('/r/a.aiff')
    },
  )

  it.each(['measuring', 'unmeasurable'] as const)(
    'does not count a copy whose length is unknown on either side, since it may be another edit (%s)',
    (verdict) => {
      expect(copyPathIn('rekordbox', rowOf(verdict), 30)).toBeUndefined()
      expect(copyPathIn('rekordbox', rowOf(verdict, 30))).toBeUndefined()
      expect(copyPathIn('rekordbox', rowOf(verdict))).toBeUndefined()
    },
  )

  it('keeps counting a measured copy of the same recording whatever the lengths say', () => {
    expect(copyPathIn('rekordbox', rowOf('same', 45), 30)).toBe('/r/a.aiff')
  })
})

describe('fillCopyPath', () => {
  const rekordbox = (verdict: LibraryVerdict | null, durationSec?: number) => ({
    path: '/r/a.aiff',
    verdict,
    durationSec,
  })
  const traktor = (verdict: LibraryVerdict | null) => ({ path: '/t/a.wav', verdict })
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
        fill({ programs: [rekordbox(verdict, 200), traktor('same')], fileDurationSec: 200 }),
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
        programs: [rekordbox('unmeasurable', 400), traktor('same')],
        fileDurationSec: 200,
      }),
    ).toBe('/t/a.wav')
  })

  // A decided verdict other than «same» can still be another edit: the comparison only calls
  // another version when both lengths are known, and a probe that could not line up says nothing.
  it('does not fill from a copy the open file beats when its length is another edit, and looks at the next program', () => {
    expect(fill({ programs: [rekordbox('here', 45), traktor('same')], fileDurationSec: 30 })).toBe(
      '/t/a.wav',
    )
  })

  it('does not fill from a copy the open file beats when its length is unknown', () => {
    expect(fill({ programs: [rekordbox('here')], fileDurationSec: 200 })).toBe('')
    expect(fill({ programs: [rekordbox('here', 200)] })).toBe('')
  })

  it('fills from a copy proven the same master even with its length unknown', () => {
    expect(fill({ programs: [rekordbox('same')] })).toBe('/r/a.aiff')
  })
})
