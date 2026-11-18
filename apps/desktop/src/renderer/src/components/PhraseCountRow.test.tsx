// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import '../i18n'
import { PhraseCountRow } from './PhraseCountRow'

afterEach(cleanup)

const BEAT = 60000 / 128
const grid = Array.from({ length: 900 }, (_, i) => ({ ms: i * BEAT, beat: (i % 4) + 1 }))
const callAt = (beat: number) => ({ id: `c${beat}`, ms: beat * BEAT, kind: 0, color: null })

function read(cues: TrackCues['cues']): TrackCues {
  return {
    contentId: '7',
    analysed: true,
    grid,
    strong: [],
    phrases: [],
    cues,
    wave: null,
    durationMs: 900 * BEAT,
    fingerprint: 'f',
    gridFingerprint: 'g',
  }
}

function renderRow(
  track: TrackCues,
  comment: string,
  onApply = vi.fn(),
  queued: QueuedCues | null = null,
) {
  const client = new QueryClient()
  client.setQueryData(['rekordbox-track-cues', '7'], track)
  client.setQueryData(['rekordbox-queued-cues', '7'], queued)
  render(
    <QueryClientProvider client={client}>
      <PhraseCountRow contentId="7" comment={comment} onApply={onApply} />
    </QueryClientProvider>,
  )
  return onApply
}

describe('PhraseCountRow', () => {
  it('shows the phrases between the CALLs so the DJ can pair tracks without loading them', () => {
    renderRow(read([0, 64, 304, 564].map(callAt)), '')
    expect(screen.getByTestId('phrase-count-value')).toHaveTextContent('2 - 7 (16) - 8 (4)')
  })

  it('puts the count in front of the comment and keeps what the DJ wrote', () => {
    const onApply = renderRow(read([0, 64, 320].map(callAt)), 'Vocal fuerte')
    fireEvent.click(screen.getByTestId('phrase-count-apply'))
    expect(onApply).toHaveBeenCalledWith('2 - 8 · Vocal fuerte')
  })

  it('counts the CALLs waiting in the queue, because those are what rekordbox will get', () => {
    const queued: QueuedCues = {
      wanted: [0, 128].map((b) => ({ ms: b * BEAT, kind: 0, color: null })),
      fingerprint: 'f',
    }
    renderRow(read([0, 64].map(callAt)), '', vi.fn(), queued)
    expect(screen.getByTestId('phrase-count-value')).toHaveTextContent('4')
  })

  it('turns the button off once the comment already carries this count, so a second click changes nothing', () => {
    renderRow(read([0, 64, 320].map(callAt)), '2 - 8 · Vocal fuerte')
    expect(screen.getByTestId('phrase-count-apply')).toBeDisabled()
  })

  it('swaps the icon for a check once the comment carries the count, so the DJ sees it is already there', () => {
    renderRow(read([0, 64, 320].map(callAt)), '2 - 8 · Vocal fuerte')
    expect(screen.getByTestId('phrase-count-done')).toBeInTheDocument()
  })

  it('shows no check while the count is still missing from the comment', () => {
    renderRow(read([0, 64, 320].map(callAt)), 'Vocal fuerte')
    expect(screen.queryByTestId('phrase-count-done')).not.toBeInTheDocument()
  })

  it('names the icon button for a screen reader, since it carries no text of its own', () => {
    renderRow(read([0, 64, 320].map(callAt)), '')
    expect(screen.getByTestId('phrase-count-apply')).toHaveAccessibleName('Put in the comment')
  })

  it('keeps the count and its action on one line, where a wrapped button used to sit alone on a second', () => {
    renderRow(read([0, 64, 320].map(callAt)), '')
    expect(screen.getByTestId('phrase-count').className.split(' ')).not.toContain('flex-wrap')
  })

  it('says two CALLs are needed while there are fewer, so the DJ knows where the count comes from', () => {
    renderRow(read([callAt(0)]), '')
    expect(screen.getByTestId('phrase-count-needs-calls')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-count-apply')).toBeDisabled()
  })
})
