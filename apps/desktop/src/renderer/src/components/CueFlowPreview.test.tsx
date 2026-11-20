// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIX_IN, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { TrackCues } from '../../../shared/types'
import i18n from '../i18n'
import { hoverTooltip } from '../test/tooltip'
import { CueFlowPreview } from './CueFlowPreview'

afterEach(cleanup)

describe('CueFlowPreview', () => {
  it('draws the flow on the example track with the drop marked and nothing to click', () => {
    render(<CueFlowPreview flow={MY_FLOW} />)
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^cue-wave-call-/)).toHaveLength(4)
    expect(screen.getByTestId('cue-wave')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('Example track at 128 BPM, marked at bar 96')).toBeInTheDocument()
  })

  it('draws a hot cue without CALL for a flow that places only hot cues', () => {
    render(<CueFlowPreview flow={ONE_AT_32} />)
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(1)
    expect(screen.getAllByTestId(/^cue-wave-call-/)).toHaveLength(1)
  })

  it('says when a flow asks for more than 8 hot cues', () => {
    const many = {
      ...ONE_AT_32,
      rules: [
        {
          ...ONE_AT_32.rules[0],
          from: 'first-beat' as const,
          direction: 'forward' as const,
          bars: 8,
          repeat: 'edge' as const,
          when: 'always' as const,
        },
      ],
    }
    render(<CueFlowPreview flow={many} />)
    expect(screen.getByTestId('cue-preview-trimmed')).toBeInTheDocument()
  })

  it('says when a flow asks for more than 8 hot cues that cannot be left out', () => {
    const one = ONE_AT_32.rules[0]
    const nine = {
      ...ONE_AT_32,
      rules: [8, 24, 40, 56, 72, 88, 104, 120, 136].map((bars) => ({
        ...one,
        from: 'first-beat' as const,
        direction: 'forward' as const,
        bars,
        when: 'always' as const,
      })),
    }
    render(<CueFlowPreview flow={nine} />)
    expect(screen.getByTestId('cue-preview-too-many')).toBeInTheDocument()
  })

  it('draws the cues a rule leaves out and says why, so the DJ sees what the condition cost', () => {
    const one = ONE_AT_32.rules[0]
    const intoChorus = { ...ONE_AT_32, rules: [{ ...one, from: 'down' as const, bars: 16 }] }
    render(<CueFlowPreview flow={intoChorus} />)
    const ghosts = screen.getAllByTestId(/^cue-wave-ghost-dropped-/)
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]).not.toHaveAttribute('title')
    expect(hoverTooltip(ghosts[0])).toBe('Rule 1, 16 bars back. Inside a chorus')
    expect(ghosts[0]).toHaveAccessibleName('Rule 1, 16 bars back. Inside a chorus')
    expect(screen.queryByTestId('cue-preview-left-out')).toBeNull()
  })

  it('joins the rule and the reason with the full stop of the language, so Japanese does not read with a Latin one', async () => {
    const one = ONE_AT_32.rules[0]
    const intoChorus = { ...ONE_AT_32, rules: [{ ...one, from: 'down' as const, bars: 16 }] }
    await i18n.changeLanguage('ja')
    try {
      render(<CueFlowPreview flow={intoChorus} />)
      const ghost = screen.getAllByTestId(/^cue-wave-ghost-dropped-/)[0]
      expect(ghost).toHaveAccessibleName('ルール 1、16 小節前。コーラスの中')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('scrolls Settings down to the whole list when it opens near the bottom edge, so the tracks are not hidden under it', () => {
    const boxes: Record<string, { top: number; bottom: number }> = {
      scroller: { top: 0, bottom: 300 },
      'cue-preview-track-menu': { top: 200, bottom: 466 },
    }
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const { top, bottom } = boxes[this.dataset.testid ?? ''] ?? { top: 0, bottom: 0 }
        return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect
      })
    try {
      render(
        <div data-testid="scroller" style={{ overflowY: 'auto' }}>
          <CueFlowPreview flow={MIX_IN} />
        </div>,
      )
      fireEvent.click(screen.getByTestId('cue-preview-track'))
      expect(screen.getByTestId('scroller').scrollTop).toBe(170)
    } finally {
      rect.mockRestore()
    }
  })

  it('says nothing about left out cues when the flow places every one', () => {
    render(<CueFlowPreview flow={ONE_AT_32} />)
    expect(screen.queryByTestId(/^cue-wave-ghost-dropped-/)).toBeNull()
  })

  describe('on a track of the DJ', () => {
    const beat = (bars: number): number => bars * 2000
    const onTrack = (cues: TrackCues['cues']): { label: string; cues: TrackCues } => ({
      label: 'DJ Made, Millenium Stringz',
      cues: {
        contentId: 'rb:1',
        analysed: true,
        grid: Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
        strong: [],
        phrases: [],
        cues,
        wave: null,
        durationMs: 400000,
        fingerprint: 'f',
        gridFingerprint: 'g',
      },
    })
    const marked = onTrack([
      { id: 'mark', ms: beat(64), kind: 0, color: null },
      { id: 'hot', ms: beat(48), kind: 1, color: 22 },
      { id: 'twin', ms: beat(48), kind: 0, color: null },
    ])

    it('places the flow on the marks the track has and says it gives the hot cues it already has', () => {
      render(<CueFlowPreview flow={MIX_IN} track={marked} />)
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent(
        'DJ Made, Millenium Stringz',
      )
      expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
      const same = screen.getByTestId('cue-preview-same')
      expect(same).toHaveAccessibleName('Same hot cues this track has now')
      expect(same).not.toHaveAttribute('title')
      expect(hoverTooltip(same)).toBe('Same hot cues this track has now')
      expect(same).toHaveTextContent('')
      expect(screen.queryByTestId('cue-preview-compare')).toBeNull()
    })

    it('counts the hot cues the flow would add or take away on that track', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        '2 hot cues differ from what this track has now',
      )
      expect(screen.queryByTestId('cue-preview-same')).toBeNull()
    })

    it('goes back to the example track on request', () => {
      render(<CueFlowPreview flow={MIX_IN} track={marked} />)
      fireEvent.click(screen.getByTestId('cue-preview-track'))
      fireEvent.click(screen.getByTestId('cue-preview-track-option-example'))
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
      expect(screen.getByText('Example track at 128 BPM, marked at bar 96')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-preview-compare')).toBeNull()
      expect(screen.queryByTestId('cue-preview-same')).toBeNull()
    })

    it('marks the track in use among the choices, so the DJ sees which one the wave is showing', () => {
      render(<CueFlowPreview flow={MIX_IN} track={marked} />)
      fireEvent.click(screen.getByTestId('cue-preview-track'))
      expect(screen.getByTestId('cue-preview-track-option-rb:1')).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByTestId('cue-preview-track-option-example')).toHaveAttribute(
        'aria-selected',
        'false',
      )
    })

    it('keeps the example track and says why when the track has no mark to place the flow on', () => {
      render(
        <CueFlowPreview
          flow={MIX_IN}
          track={onTrack([{ id: 'hot', ms: beat(48), kind: 1, color: 22 }])}
        />,
      )
      expect(screen.getByTestId('cue-preview-no-mark')).toBeInTheDocument()
      expect(screen.getByText('Example track at 128 BPM, marked at bar 96')).toBeInTheDocument()
    })
  })
  describe('choosing the track', () => {
    const LIST = [
      { contentId: 'rb:2', label: 'Âme, Rej' },
      { contentId: 'rb:3', label: 'Bicep, Glue' },
    ]
    const open = (): void => {
      fireEvent.click(screen.getByTestId('cue-preview-track'))
    }

    it('keeps the selector with the example as its only choice when there is no list to pick from', () => {
      render(<CueFlowPreview flow={MY_FLOW} />)
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
      expect(screen.getByTestId('cue-preview-track')).toHaveAttribute('aria-expanded', 'false')
      open()
      expect(screen.getByTestId('cue-preview-track')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getAllByRole('option')).toHaveLength(1)
      expect(screen.queryByTestId('cue-preview-track-separator')).toBeNull()
    })

    it('offers the example first and the tracks of the open list under it, so any of them can be tried', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      expect(screen.getByTestId('cue-preview-track-listbox')).toHaveAttribute('role', 'listbox')
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Example track',
        'Âme, Rej',
        'Bicep, Glue',
      ])
      expect(screen.getByTestId('cue-preview-track-separator')).toBeInTheDocument()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveAttribute(
        'placeholder',
        'Search the open list',
      )
    })

    it('hands over the track picked, closes the choices and gives the focus back to the selector', () => {
      const onPick = vi.fn()
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} onPick={onPick} />)
      open()
      fireEvent.click(screen.getByTestId('cue-preview-track-option-rb:3'))
      expect(onPick).toHaveBeenCalledWith({ contentId: 'rb:3', label: 'Bicep, Glue' })
      expect(screen.queryByTestId('cue-preview-track-listbox')).toBeNull()
      expect(screen.getByTestId('cue-preview-track')).toHaveFocus()
    })

    it('finds a track by a name typed without its accents or capitals', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'ame' } })
      expect(screen.getByTestId('cue-preview-track-option-rb:2')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-preview-track-option-rb:3')).toBeNull()
      expect(screen.queryByTestId('cue-preview-track-empty')).toBeNull()
    })

    it('says no marked track has that name instead of leaving the choices blank', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'zzz' } })
      expect(screen.getByTestId('cue-preview-track-empty')).toHaveTextContent(
        'No marked track with that name',
      )
      expect(screen.getByTestId('cue-preview-track-option-example')).toBeInTheDocument()
    })

    it('draws only the first hundred of a long list, so it opens at once and the search reaches the rest', () => {
      const long = Array.from({ length: 150 }, (_, i) => ({
        contentId: `rb:${i}`,
        label: `Track ${i}`,
      }))
      render(<CueFlowPreview flow={MY_FLOW} tracks={long} />)
      open()
      expect(screen.getAllByRole('option')).toHaveLength(101)
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), {
        target: { value: 'track 149' },
      })
      expect(screen.getByTestId('cue-preview-track-option-rb:149')).toBeInTheDocument()
    })

    it('closes on Escape without the press reaching Settings, which would close with it', () => {
      const reached = vi.fn()
      window.addEventListener('keydown', reached)
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.keyDown(screen.getByTestId('cue-preview-track-search'), { key: 'Escape' })
      window.removeEventListener('keydown', reached)
      expect(screen.queryByTestId('cue-preview-track-listbox')).toBeNull()
      expect(screen.getByTestId('cue-preview-track')).toHaveFocus()
      expect(reached).not.toHaveBeenCalled()
    })

    it('closes on a click anywhere else and keeps the track it was showing', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByTestId('cue-preview-track-listbox')).toBeNull()
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
    })

    it('starts the search empty each time it opens, so an old search does not hide the list', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'zzz' } })
      fireEvent.mouseDown(document.body)
      open()
      expect(screen.getAllByRole('option')).toHaveLength(3)
    })

    it('walks the choices with the arrow keys from the search field', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.keyDown(screen.getByTestId('cue-preview-track-search'), { key: 'ArrowDown' })
      expect(screen.getByTestId('cue-preview-track-option-example')).toHaveFocus()
      fireEvent.keyDown(screen.getByTestId('cue-preview-track-option-example'), {
        key: 'ArrowDown',
      })
      expect(screen.getByTestId('cue-preview-track-option-rb:2')).toHaveFocus()
      fireEvent.keyDown(screen.getByTestId('cue-preview-track-option-rb:2'), { key: 'ArrowUp' })
      expect(screen.getByTestId('cue-preview-track-option-example')).toHaveFocus()
    })
  })
})
