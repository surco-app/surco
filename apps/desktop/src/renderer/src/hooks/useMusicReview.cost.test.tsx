// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as spelling from '../lib/musicSpelling'
import type { ReviewSource } from '../lib/reviewSource'
import { useMusicReview } from './useMusicReview'

vi.mock('../lib/musicSpelling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/musicSpelling')>()
  return { ...actual, spellingGroups: vi.fn(actual.spellingGroups) }
})

const entry = (id: string, artist: string) => ({
  id,
  title: id,
  artist,
  albumArtist: '',
  album: '',
  genre: '',
})

describe('useMusicReview cost', () => {
  // Ignoring is one click per group on a list of thousands; regrouping everything on each
  // click was the cost the user would feel most.
  it('does not regroup the whole list when a group is ignored', async () => {
    ;(window as unknown as { api: unknown }).api = {
      libraryStatus: vi.fn().mockResolvedValue(null),
    }
    const source = {
      kind: 'list',
      load: vi.fn().mockResolvedValue({
        entries: [
          entry('/a', 'DJ Lara'),
          entry('/b', 'DJ Lara'),
          entry('/c', 'Dj Lara'),
          entry('/d', 'Kim  Lee'),
          entry('/e', 'Kim Lee'),
        ],
        skipped: 0,
      }),
      locate: async (id: string) => id,
    } as unknown as ReviewSource
    const { result } = renderHook(() =>
      useMusicReview({
        source,
        initialFilter: 'all',
        ignored: [],
        saveIgnored: vi.fn(),
        onFilesChanged: vi.fn(),
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const calls = vi.mocked(spelling.spellingGroups).mock.calls.length
    act(() => result.current.ignore(result.current.spelling[0].key))
    expect(result.current.spelling).toHaveLength(1)
    expect(vi.mocked(spelling.spellingGroups).mock.calls.length).toBe(calls)
  })
})
