// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DamageFinding } from '../../../shared/types'
import type { MusicReview as Review } from '../hooks/useMusicReview'
import i18n from '../i18n'
import { damageKey } from '../lib/damageReview'
import { DamageDetail } from './DamageDetail'

afterEach(cleanup)
beforeEach(() => i18n.changeLanguage('es'))

const traktor: DamageFinding = {
  id: 'traktor-source-cues\0/m/uno.mp3',
  kind: 'traktor-source-cues',
  path: '/m/uno.mp3',
  certainty: 'likely',
  evidence: [
    { key: 'damage.evidence.traktorTookSibling', params: { sibling: 'uno.aiff', ms: 51.18 } },
  ],
  before: { key: 'damage.value.cueAt', params: { sec: 9.94882 } },
  after: { key: 'damage.value.cueAt', params: { sec: 10 } },
  options: [],
  repair: { target: 'traktor', path: '/m/uno.mp3', addMs: 51.18 },
}

const genre: DamageFinding = {
  id: 'genre-number\0/m/dos.mp3',
  kind: 'genre-number',
  path: '/m/dos.mp3',
  certainty: 'likely',
  evidence: [
    { key: 'damage.evidence.id3v1Number', params: { number: 35, name: 'House' } },
    { key: 'damage.evidence.maybeLegacy' },
  ],
  before: { key: 'damage.value.text', params: { value: '(35) Deep House' } },
  options: ['House; Deep House', 'House/Deep House'],
  repair: { target: 'genre', path: '/m/dos.mp3', from: '(35) Deep House', to: 'House; Deep House' },
}

function review(over: Partial<Review> = {}): Review {
  return {
    status: 'ready',
    staged: new Set(),
    choice: () => null,
    choose: vi.fn(),
    toggleStaged: vi.fn(),
    ignore: vi.fn(),
    facts: () => undefined,
    ...over,
  } as unknown as Review
}

// The detail is the proof: every line the scan gave, with its numbers as the user's locale
// writes them, before anything is staged.
describe('DamageDetail', () => {
  it('lists the evidence with its numbers in the locale', () => {
    render(<DamageDetail finding={traktor} review={review()} />)
    expect(screen.getByTestId('damage-evidence')).toHaveTextContent('51,18 ms')
    expect(screen.getByTestId('damage-before')).toHaveTextContent('Primer cue en 9,949 s')
    expect(screen.getByTestId('damage-after')).toHaveTextContent('10 s')
  })

  it('names the cue in the masculine, as the rest of the app does', () => {
    render(
      <DamageDetail
        finding={{
          ...traktor,
          evidence: [
            {
              key: 'damage.evidence.traktorTree',
              params: { fileSec: 10, entrySec: 9.949, sibling: 'uno.aiff' },
            },
          ],
        }}
        review={review()}
      />,
    )
    expect(screen.getByTestId('damage-evidence')).toHaveTextContent(
      'El MP3 guarda el primer cue en 10 s y Traktor lo tiene en 9,949 s, igual que uno.aiff',
    )
  })

  it('offers the other spellings of a genre and stages the chosen one', () => {
    const choose = vi.fn()
    const toggleStaged = vi.fn()
    render(
      <DamageDetail
        finding={genre}
        review={review({ choose, toggleStaged, choice: () => 'House/Deep House' })}
      />,
    )
    expect(screen.getAllByTestId('damage-evidence').map((li) => li.textContent)).toEqual([
      'En ID3v1, 35 es House',
      'Puede ser un género antiguo escrito así a propósito',
    ])
    expect(screen.getByTestId('damage-after')).toHaveTextContent('House/Deep House')
    fireEvent.click(screen.getByTestId('damage-option'))
    fireEvent.click(screen.getByTestId('damage-option-option-House; Deep House'))
    expect(choose).toHaveBeenCalledWith(damageKey(genre), 'House; Deep House')
    fireEvent.click(screen.getByTestId('damage-stage'))
    expect(toggleStaged).toHaveBeenCalledWith(damageKey(genre))
  })

  it('has nothing to stage for a warning', () => {
    render(<DamageDetail finding={{ ...traktor, repair: null }} review={review()} />)
    expect(screen.queryByTestId('damage-stage')).toBeNull()
    expect(screen.getByTestId('damage-warn-only')).toBeInTheDocument()
  })

  it('has nothing to stage while its repair waits in a queue', () => {
    render(<DamageDetail finding={{ ...traktor, pending: true }} review={review()} />)
    expect(screen.queryByTestId('damage-stage')).toBeNull()
  })
})
