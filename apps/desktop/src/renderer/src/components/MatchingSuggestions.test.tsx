// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionTrack } from '../../../shared/types'
import i18n from '../i18n'
import { MatchingSuggestions, MatchingSuggestionsToggle } from './MatchingSuggestions'

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

function setup(suggestions = [{ pair: ['1', '2'] as [string, string], times: 27 }], open = true) {
  const handlers = { onMatch: vi.fn(), onDismiss: vi.fn() }
  render(
    <MatchingSuggestions suggestions={suggestions} tracks={TRACKS} open={open} {...handlers} />,
  )
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

  it('shortens the count to a figure and still says it in full to a screen reader', () => {
    setup()
    const times = screen.getByTestId('matching-suggestion-times')
    expect(times).toHaveTextContent('27×')
    expect(times).toHaveTextContent(i18n.t('sources.matchingTimes', { count: 27 }))
  })

  it('names its two icon buttons, since neither carries a word', () => {
    setup()
    expect(screen.getByTestId('matching-suggestion-match')).toHaveAccessibleName(
      i18n.t('trackList.context.matching'),
    )
    expect(screen.getByTestId('matching-suggestion-dismiss')).toHaveAccessibleName(
      i18n.t('sources.matchingDismiss'),
    )
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

  it('shows three at first and the rest on demand, so the blocks stay in reach', () => {
    setup(many)
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(3)
    fireEvent.click(screen.getByTestId('matching-suggestions-more'))
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(6)
    fireEvent.click(screen.getByTestId('matching-suggestions-more'))
    expect(screen.getAllByTestId('matching-suggestion')).toHaveLength(7)
    expect(screen.queryByTestId('matching-suggestions-more')).not.toBeInTheDocument()
  })

  it('takes no room at all while closed, so the blocks start right under the toolbar', () => {
    setup(many, false)
    expect(screen.queryByTestId('matching-suggestions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('matching-suggestion')).not.toBeInTheDocument()
  })

  it('says what its rows are with a title that is no longer a control', () => {
    setup(many)
    const title = screen.getByRole('heading', { name: i18n.t('sources.matchingSuggested') })
    expect(title.querySelector('button')).toBeNull()
    expect(title).not.toHaveTextContent('7')
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

describe('MatchingSuggestionsToggle', () => {
  it('opens and closes the suggestions from the toolbar and says which way it is', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<MatchingSuggestionsToggle open onToggle={onToggle} />)
    const toggle = screen.getByTestId('matching-suggestions-toggle')
    expect(toggle).toHaveAccessibleName(i18n.t('sources.matchingSuggested'))
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()
    rerender(<MatchingSuggestionsToggle open={false} onToggle={onToggle} />)
    expect(screen.getByTestId('matching-suggestions-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('stays in place but out of use while a search hides the suggestions', () => {
    render(<MatchingSuggestionsToggle open disabled onToggle={vi.fn()} />)
    expect(screen.getByTestId('matching-suggestions-toggle')).toBeDisabled()
  })
})
