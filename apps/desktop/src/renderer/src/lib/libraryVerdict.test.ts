import { describe, expect, it } from 'vitest'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import { aggregateLibraryVerdict, musicRowVerdict, rowVerdict } from './libraryVerdict'

describe('aggregateLibraryVerdict', () => {
  it('lets a better library copy win over everything else', () => {
    expect(aggregateLibraryVerdict(['here', 'library'])).toBe('library')
  })

  it('waits while any copy is still being measured', () => {
    expect(aggregateLibraryVerdict(['here', 'measuring'])).toBe('measuring')
  })

  it('prefers this file over a copy that is the same', () => {
    expect(aggregateLibraryVerdict(['here', 'same'])).toBe('here')
  })

  // A folded header shows one state: the one that asks the most of the reader. Another
  // version in the library is worth knowing before two copies that are merely alike, and
  // both before an identical copy, which asks nothing.
  it('ranks the states from the most to the least urgent', () => {
    const order = [
      'library',
      'measuring',
      'here',
      'different',
      'missing',
      'unreadable',
      'unmeasurable',
      'tie',
      'even',
      'same',
      'thisFile',
    ] as const
    order.forEach((verdict, i) => {
      expect(aggregateLibraryVerdict([...order.slice(i)].reverse())).toBe(verdict)
    })
  })

  it('reports same when it is the only decision', () => {
    expect(aggregateLibraryVerdict(['same', null])).toBe('same')
  })

  it('has no verdict when no copy decided', () => {
    expect(aggregateLibraryVerdict([null])).toBeNull()
    expect(aggregateLibraryVerdict([])).toBeNull()
  })
})

describe('rowVerdict', () => {
  const facts = {
    verdict: null,
    measuring: false,
    format: '',
    missing: false,
    unreadable: false,
    checking: false,
  }
  it.each([
    [{ ...facts, measuring: true }, 'measuring'],
    [facts, 'unmeasurable'],
    [{ ...facts, verdict: { winner: 'tie', sameMaster: true } }, 'tie'],
    [{ ...facts, verdict: { winner: 'tie' } }, 'even'],
    [{ ...facts, verdict: { winner: 'different' } }, 'different'],
    [{ ...facts, verdict: { winner: 'a', reason: 'format' } }, 'here'],
    [{ ...facts, verdict: { winner: 'b', reason: 'format' } }, 'library'],
    [{ ...facts, verdict: { winner: 'same' } }, 'same'],
    [{ ...facts, missing: true }, 'missing'],
    [{ ...facts, unreadable: true }, 'unreadable'],
    [{ ...facts, checking: true }, 'measuring'],
  ] as const)('maps %j to %s', (state, expected) => {
    expect(rowVerdict(state as unknown as CopyVerdictState)).toBe(expected)
  })

  // Two copies nothing separates, not shown to be one master, used to leave the row blank,
  // and a blank row read as if Surco had not looked: the row says neither copy is better.
  it('says a tie between two masters instead of leaving the row blank', () => {
    expect(rowVerdict({ ...facts, verdict: { winner: 'tie' } })).toBe('even')
  })

  // A copy that cannot be reached says so, even where a verdict would have been measured.
  it('says a copy is gone or unreadable over any measurement', () => {
    expect(rowVerdict({ ...facts, measuring: true, missing: true } as CopyVerdictState)).toBe(
      'missing',
    )
  })

  // A verdict computed while a fact was still pending would call two copies different
  // before the probe that lines them up had answered.
  it('keeps measuring over any verdict while a fact is pending', () => {
    expect(
      rowVerdict({
        ...facts,
        measuring: true,
        verdict: { winner: 'different' },
      } as CopyVerdictState),
    ).toBe('measuring')
  })
})

describe('musicRowVerdict', () => {
  const settled = {
    musicHoldsFile: false,
    tiedCopies: 0,
    libraryCopyPath: '/music/song.mp3',
    libraryCopyPending: false,
    musicCopyReach: undefined,
    libraryCopyBetter: false,
    copyState: 'same',
  } as const

  it('says this file is the one Music holds, whatever else is known', () => {
    expect(
      musicRowVerdict({
        ...settled,
        musicHoldsFile: true,
        tiedCopies: 3,
        musicCopyReach: { missing: true, unreadable: true, checking: true },
      }),
    ).toBe('thisFile')
  })

  it('says several when Music keeps tied copies, before looking at any one of them', () => {
    expect(
      musicRowVerdict({
        ...settled,
        tiedCopies: 2,
        libraryCopyPath: '',
        musicCopyReach: { missing: true, unreadable: false, checking: false },
      }),
    ).toBe('several')
  })

  it('says missing when Music has no copy and none is being looked up', () => {
    expect(musicRowVerdict({ ...settled, libraryCopyPath: '' })).toBe('missing')
  })

  it('does not say missing while the copy is still being looked up', () => {
    expect(musicRowVerdict({ ...settled, libraryCopyPath: '', libraryCopyPending: true })).toBe(
      'measuring',
    )
  })

  it('says missing when the copy file is gone from disk', () => {
    expect(
      musicRowVerdict({
        ...settled,
        musicCopyReach: { missing: true, unreadable: true, checking: true },
      }),
    ).toBe('missing')
  })

  it('says unreadable when the copy is there but cannot be read', () => {
    expect(
      musicRowVerdict({
        ...settled,
        musicCopyReach: { missing: false, unreadable: true, checking: true },
      }),
    ).toBe('unreadable')
  })

  it('says measuring while the copy check is not settled', () => {
    expect(
      musicRowVerdict({
        ...settled,
        libraryCopyBetter: true,
        copyState: 'unmeasurable',
        musicCopyReach: { missing: false, unreadable: false, checking: true },
      }),
    ).toBe('measuring')
  })

  it.each(['unmeasurable', 'measuring'] as const)(
    'warns the library copy is better when it looks worse than the file and the comparison is %s',
    (copyState) => {
      expect(musicRowVerdict({ ...settled, libraryCopyBetter: true, copyState })).toBe('library')
    },
  )

  it('trusts the measured comparison over the early guess that the library copy is better', () => {
    expect(musicRowVerdict({ ...settled, libraryCopyBetter: true, copyState: 'here' })).toBe('here')
  })

  it('keeps measuring while the copy path is pending and not yet known', () => {
    expect(
      musicRowVerdict({
        ...settled,
        libraryCopyPath: '',
        libraryCopyPending: true,
        copyState: 'here',
      }),
    ).toBe('measuring')
  })

  it.each(['here', 'library', 'same', 'even', 'unmeasurable'] as const)(
    'falls back to the compared state %s',
    (copyState) => {
      expect(musicRowVerdict({ ...settled, copyState })).toBe(copyState)
    },
  )

  it('falls back to the compared state while a pending lookup already has a path', () => {
    expect(musicRowVerdict({ ...settled, libraryCopyPending: true, copyState: 'different' })).toBe(
      'different',
    )
  })
})
