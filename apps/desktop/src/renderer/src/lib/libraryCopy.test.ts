import { describe, expect, it } from 'vitest'
import type { LibraryVerdict } from '../components/LibrarySection'
import { copyPathIn, countsAsCopy } from './libraryCopy'

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
