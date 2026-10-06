import { describe, expect, it } from 'vitest'
import type { MusicReviewEntry } from '../../../shared/types'
import { planFixes, summarizeFixes } from './musicFixPlan'
import { spellingGroups } from './musicSpelling'

const e = (persistentId: string, over: Partial<MusicReviewEntry>): MusicReviewEntry => ({
  persistentId,
  title: 'T',
  artist: '',
  albumArtist: '',
  album: '',
  genre: '',
  ...over,
})

describe('planFixes', () => {
  it('rewrites the act inside the full credit Music holds', () => {
    const entries = [
      e('A', { artist: 'DJ Lara' }),
      e('B', { artist: 'DJ Lara' }),
      e('C', { artist: 'Dj Lara, DJ Sergi Val' }),
    ]
    const [group] = spellingGroups(entries)
    expect(planFixes(entries, [{ group, to: 'DJ Lara' }])).toEqual([
      {
        persistentId: 'C',
        field: 'artist',
        from: 'Dj Lara, DJ Sergi Val',
        to: 'DJ Lara, DJ Sergi Val',
      },
    ])
  })

  it('folds two choices that touch the same credit into one change', () => {
    const entries = [
      e('A', { artist: 'DJ Lara' }),
      e('B', { artist: 'DJ Lara' }),
      e('C', { artist: 'Dj Lara & dj sergi val' }),
      e('D', { artist: 'DJ Sergi Val' }),
      e('F', { artist: 'DJ Sergi Val' }),
    ]
    const groups = spellingGroups(entries).filter((g) => g.field === 'artist')
    const fixes = planFixes(
      entries,
      groups.map((group) => ({ group, to: group.suggested as string })),
    )
    expect(fixes).toEqual([
      {
        persistentId: 'C',
        field: 'artist',
        from: 'Dj Lara & dj sergi val',
        to: 'DJ Lara & DJ Sergi Val',
      },
    ])
  })

  it('replaces a whole album or genre only where it equals the variant', () => {
    const entries = [
      e('A', { genre: 'Electronic' }),
      e('B', { genre: 'Electronic' }),
      e('C', { genre: 'electronic' }),
    ]
    const [group] = spellingGroups(entries)
    expect(planFixes(entries, [{ group, to: 'Electronic' }])).toEqual([
      { persistentId: 'C', field: 'genre', from: 'electronic', to: 'Electronic' },
    ])
  })

  it('plans nothing when the chosen spelling is what every track already has', () => {
    const entries = [e('A', { genre: 'Electronic' }), e('C', { genre: 'electronic' })]
    const [group] = spellingGroups(entries)
    const onlyChosen = {
      ...group,
      variants: group.variants.filter((v) => v.value === 'Electronic'),
    }
    expect(planFixes(entries, [{ group: onlyChosen, to: 'Electronic' }])).toEqual([])
  })
})

describe('summarizeFixes', () => {
  it('counts tracks once and changes per field', () => {
    expect(
      summarizeFixes([
        { persistentId: 'A', field: 'artist', from: 'a', to: 'b' },
        { persistentId: 'A', field: 'genre', from: 'a', to: 'b' },
        { persistentId: 'B', field: 'artist', from: 'a', to: 'b' },
      ]),
    ).toEqual({ tracks: 2, byField: { artist: 2, genre: 1 } })
  })
})
