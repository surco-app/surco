import { describe, expect, it } from 'vitest'
import type { CopyVerdictState } from '../hooks/useCopyVerdicts'
import { aggregateLibraryVerdict, rowVerdict } from './libraryVerdict'

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
  const facts = { verdict: null, measuring: false, format: '', missing: false, unreadable: false }
  it.each([
    [{ ...facts, measuring: true }, 'measuring'],
    [facts, null],
    [{ ...facts, verdict: { winner: 'tie', sameMaster: true } }, 'tie'],
    [{ ...facts, verdict: { winner: 'tie' } }, 'even'],
    [{ ...facts, verdict: { winner: 'different' } }, 'different'],
    [{ ...facts, verdict: { winner: 'a', reason: 'format' } }, 'here'],
    [{ ...facts, verdict: { winner: 'b', reason: 'format' } }, 'library'],
    [{ ...facts, verdict: { winner: 'same' } }, 'same'],
    [{ ...facts, missing: true }, 'missing'],
    [{ ...facts, unreadable: true }, 'unreadable'],
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
