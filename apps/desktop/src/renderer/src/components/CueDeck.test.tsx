// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import i18n from '../i18n'
import { CueDeck } from './CueDeck'

function setup(over: Partial<React.ComponentProps<typeof CueDeck>> = {}) {
  const handlers = {
    onPlay: vi.fn<() => void>(),
    onPad: vi.fn<(kind: number) => void>(),
    onRecolour: vi.fn<(key: string, color: number) => void>(),
    onMemory: vi.fn<() => void>(),
    onMemoryStep: vi.fn<(dir: 1 | -1) => void>(),
    onMemoryRemove: vi.fn<() => void>(),
    onJumpBars: vi.fn<(bars: CueJumpBars) => void>(),
    onQuantize: vi.fn<(unit: CueQuantize) => void>(),
  }
  render(
    <CueDeck
      cues={[
        { key: 'a', kind: 1, color: 42 },
        { key: 'p', kind: 0, color: null },
      ]}
      selected="a"
      locked={[]}
      jumpBars={16}
      quantize="bar"
      playing={false}
      canRemoveMemory
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('CueDeck', () => {
  it('shows only the pads the library has buttons for, so a Traktor track offers A to G', () => {
    setup({ kinds: [1, 2, 3, 5, 6, 7, 8] })
    expect(screen.getByTestId('cues-pad-G')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-pad-H')).not.toBeInTheDocument()
  })

  it('shows pads A to H, filled with their colour where a hot cue is and empty where none is, with no key hints', () => {
    setup()
    for (const letter of 'ABCDEFGH')
      expect(screen.getByTestId(`cues-pad-${letter}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('data-set', 'true')
    expect(screen.getByTestId('cues-pad-A')).toHaveStyle({ backgroundColor: '#e62828' })
    expect(screen.getByTestId('cues-pad-A').textContent).toBe('A')
    expect(screen.getByTestId('cues-pad-H').textContent).toBe('H')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('data-set', 'false')
    expect(screen.getByTestId('cues-pad-B').style.backgroundColor).toBe('')
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

  it('opens rekordbox picker on a right click on a pad with a hot cue and recolours it', () => {
    const { onRecolour } = setup()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cues-pad-colours')).toBeInTheDocument()
    expect(screen.getByTestId('cue-palette-42')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-palette-5'))
    expect(onRecolour).toHaveBeenCalledWith('a', 5)
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('opens no picker on an empty pad or on a loop', () => {
    setup({ locked: ['a'] })
    fireEvent.contextMenu(screen.getByTestId('cues-pad-B'))
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('closes the picker with Escape or a click elsewhere', () => {
    setup()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('keeps Escape from the window listener that restores the maximized section', () => {
    setup()
    const onWindowKey = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', onWindowKey)
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.keyDown(document, { key: 'Escape' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('walks the CALLs with ‹ › and puts one at the playhead with + CALL', () => {
    const h = setup()
    expect(screen.getByTestId('cues-memory')).toHaveTextContent('CALL')
    expect(screen.getByTestId('cues-memory')).toHaveAccessibleName('Add a CALL at the playhead')
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(h.onMemory).toHaveBeenCalledTimes(1)
    expect(h.onMemoryStep.mock.calls).toEqual([[-1], [1]])
  })

  it('removes the current CALL with the ✕ after ›, and greys it out when there is none', () => {
    const h = setup()
    expect(screen.getByTestId('cues-memory-remove')).toHaveAccessibleName('Delete')
    expect(screen.getByTestId('cues-memory-next').nextElementSibling).toBe(
      screen.getByTestId('cues-memory-remove'),
    )
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(h.onMemoryRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('cues-deck')).not.toHaveTextContent('MEMORY')
  })

  it('does nothing from the ✕ and says so with aria-disabled when no CALL is there', () => {
    const h = setup({ canRemoveMemory: false })
    expect(screen.getByTestId('cues-memory-remove')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(h.onMemoryRemove).not.toHaveBeenCalled()
  })

  it('plays and pauses with its button and says which one it will do', () => {
    const { onPlay } = setup()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  it('says Pause while the track sounds', () => {
    setup({ playing: true })
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Pause')
  })

  it('picks the jump from a menu of 8, 16, 32 and 64 bars', () => {
    const { onJumpBars } = setup()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump'))
    const names = within(screen.getByTestId('cues-jump-listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['8 bars', '16 bars', '32 bars', '64 bars'])
    fireEvent.click(screen.getByTestId('cues-jump-option-32'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })

  it('shows the quantize as Q and the unit beside the jump, and picks the beat from its menu', () => {
    const { onQuantize } = setup()
    expect(screen.getByTestId('cues-quantize-group')).toHaveTextContent('QBar')
    fireEvent.click(screen.getByTestId('cues-quantize'))
    const names = within(screen.getByTestId('cues-quantize-listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['Bar', 'Beat'])
    fireEvent.click(screen.getByTestId('cues-quantize-option-beat'))
    expect(onQuantize).toHaveBeenCalledWith('beat')
  })

  it('says Q Compás and Q Golpe in Spanish, as Vicent counts', async () => {
    await i18n.changeLanguage('es')
    try {
      setup({ quantize: 'beat' })
      expect(screen.getByTestId('cues-quantize-group')).toHaveTextContent('QGolpe')
      expect(screen.getByTestId('cues-quantize')).toHaveAccessibleName(/Cuantizar/)
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('draws Play and Pause like the player, a rounded square with a soft hover and filled icons', () => {
    setup()
    const play = screen.getByTestId('cues-play')
    expect(play.className).toContain('rounded-md')
    expect(play.className).not.toContain('rounded-full')
    expect(play.className).toContain('h-7 w-7')
    expect(play.className).toContain('hover:bg-[var(--color-line-strong)]')
    expect(play.querySelector('svg')).toHaveAttribute('fill', 'currentColor')
  })
})
