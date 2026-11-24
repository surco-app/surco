import { describe, expect, it } from 'vitest'
import type { LibraryVerdict } from '../components/LibrarySection'
import { copyPathIn, countsAsCopy } from './libraryCopy'

describe('countsAsCopy', () => {
  it.each(['same', 'even', 'tie', 'here', 'library', 'unmeasurable', 'measuring'] as const)(
    'counts every verdict about the same recording as a copy, since the DJ already has that track there (%s)',
    (verdict) => {
      expect(countsAsCopy(verdict)).toBe(true)
    }
  )

  it.each(['different', 'unreadable', 'missing', 'thisFile'] as const)(
    'does not count another version, an unreachable copy or the open file itself (%s)',
    (verdict) => {
      expect(countsAsCopy(verdict)).toBe(false)
    }
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
      { program: 'engine', path: '/e/a.mp3', verdict: 'different' }
    ]
    expect(copyPathIn('rekordbox', rows)).toBe('/r/a.aiff')
    expect(copyPathIn('engine', rows)).toBeUndefined()
  })
})
