// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CueJumpBars } from '../../../shared/cueJump'
import '../i18n'
import { CueDeck } from './CueDeck'

function setup(over: Partial<React.ComponentProps<typeof CueDeck>> = {}) {
  const handlers = {
    onPad: vi.fn<(kind: number) => void>(),
    onMemory: vi.fn<() => void>(),
    onMemoryStep: vi.fn<(dir: 1 | -1) => void>(),
    onMemoryRemove: vi.fn<() => void>(),
    onJumpBars: vi.fn<(bars: CueJumpBars) => void>(),
  }
  render(
    <CueDeck
      cues={[
        { key: 'a', kind: 1, color: 42 },
        { key: 'p', kind: 0, color: null },
      ]}
      selected="a"
      jumpBars={16}
      canRemoveMemory
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('CueDeck', () => {
  it('shows pads A to H with the key that sets each, coloured where a hot cue is', () => {
    setup()
    for (const letter of 'ABCDEFGH')
      expect(screen.getByTestId(`cues-pad-${letter}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('data-set', 'true')
    expect(screen.getByTestId('cues-pad-A')).toHaveStyle({ backgroundColor: '#e62828' })
    expect(screen.getByTestId('cues-pad-A')).toHaveTextContent('A1')
    expect(screen.getByTestId('cues-pad-H')).toHaveTextContent('H8')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('data-set', 'false')
  })

  it('marks the pad of the selected hot cue', () => {
    setup()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'false')
  })

  it('hands the rekordbox letter of the pad, so D is kind 5', () => {
    const { onPad } = setup()
    fireEvent.click(screen.getByTestId('cues-pad-D'))
    expect(onPad).toHaveBeenCalledWith(5)
  })

  it('puts, walks and removes CALLs with MEMORY and its arrows', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(h.onMemory).toHaveBeenCalledTimes(1)
    expect(h.onMemoryStep.mock.calls).toEqual([[-1], [1]])
    expect(h.onMemoryRemove).toHaveBeenCalledTimes(1)
  })

  it('greys out ✕ when there is no CALL at the playhead to remove', () => {
    const h = setup({ canRemoveMemory: false })
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.getByTestId('cues-memory-remove')).toBeDisabled()
    expect(h.onMemoryRemove).not.toHaveBeenCalled()
  })

  it('steps the jump through 8, 16, 32 and 64 bars', () => {
    const { onJumpBars } = setup()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump-less'))
    fireEvent.click(screen.getByTestId('cues-jump-more'))
    expect(onJumpBars.mock.calls).toEqual([[8], [32]])
  })

  it('stops shortening the jump at 8 bars', () => {
    setup({ jumpBars: 8 })
    expect(screen.getByTestId('cues-jump-less')).toBeDisabled()
  })

  it('offers no longer jump than 64 bars', () => {
    setup({ jumpBars: 64 })
    expect(screen.getByTestId('cues-jump-more')).toBeDisabled()
  })
})
