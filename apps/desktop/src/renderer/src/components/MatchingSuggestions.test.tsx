// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionTrack } from '../../../shared/types'
import '../i18n'
import { MatchingSuggestions } from './MatchingSuggestions'

afterEach(cleanup)

const track = (contentId: string, title: string, artist = 'DJ'): CollectionTrack => ({
  contentId,
  path: `/m/${contentId}.wav`,
  title,
  artist,
})

const TRACKS = new Map(
  [
    track('1', 'In The Evening', 'Sheryl Lee Ralph'),
    track('2', 'Get Down', 'Avant Garde'),
    ...Array.from({ length: 14 }, (_, i) => track(`t${i}`, `Track ${i}`)),
  ].map((t) => [t.contentId, t]),
)

const many = Array.from({ length: 7 }, (_, i) => ({
  pair: [`t${2 * i}`, `t${2 * i + 1}`] as [string, string],
  times: 10 - i,
}))

function setup(suggestions = [{ pair: ['1', '2'] as [string, string], times: 27 }]) {
  const handlers = { onMatch: vi.fn(), onDismiss: vi.fn() }
  render(<MatchingSuggestions suggestions={suggestions} tracks={TRACKS} {...handlers} />)
  return handlers
}

describe('MatchingSuggestions', () => {
  it('shows the two tracks and how many times they were played back to back', () => {
    setup()
    const card = screen.getByTestId('matching-suggestion')
    expect(card).toHaveTextContent('In The Evening')
    expect(card).toHaveTextContent('Get Down')
    expect(card).toHaveTextContent('27')
  })

  it('pairs the two tracks in one click', () => {
    const { onMatch } = setup()
    fireEvent.click(screen.getByTestId('matching-suggestion-match'))
    expect(onMatch).toHaveBeenCalledWith({ pair: ['1', '2'], times: 27 })
  })

  it('dismisses a suggestion the DJ does not want', () => {
    const { onDismiss, onMatch } = setup()
    fireEvent.click(screen.getByTestId('matching-suggestion-dismiss'))
    expect(onDismiss).toHaveBeenCalledWith({ pair: ['1', '2'], times: 27 })
    expect(onMatch).not.toHaveBeenCalled()
  })

  it('shows five at first and the rest on demand, so the chains stay in reach', () => {
    setup(many)
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(5)
    fireEvent.click(screen.getByTestId('matching-suggestions-more'))
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(7)
    expect(screen.queryByTestId('matching-suggestions-more')).not.toBeInTheDocument()
  })

  it('leaves out a pair whose tracks it cannot name yet, instead of a blank card', () => {
    setup([
      { pair: ['1', 'unknown'], times: 9 },
      { pair: ['1', '2'], times: 4 },
    ])
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(1)
    expect(screen.getByTestId('matching-suggestion')).toHaveTextContent('Get Down')
  })

  it('renders nothing when there is nothing to suggest', () => {
    setup([])
    expect(screen.queryByTestId('matching-suggestions')).not.toBeInTheDocument()
  })
})
