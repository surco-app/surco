// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALLS_ONLY, MIX_IN, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
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

  it('keeps room on its left edge for the ring of a new cue at the very start and for the focus ring of the count, which Settings would clip', () => {
    render(<CueFlowPreview flow={MY_FLOW} />)
    expect(screen.getByTestId('cue-flow-preview')).toHaveClass('pl-1')
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

    const onlyMark = onTrack([{ id: 'mark', ms: beat(64), kind: 0, color: null }])
    const keepsOne = onTrack([
      { id: 'mark', ms: beat(64), kind: 0, color: null },
      { id: 'kept', ms: beat(32), kind: 2, color: 42 },
      { id: 'hot', ms: beat(48), kind: 1, color: 22 },
    ])
    const twoMarks = onTrack([
      { id: 'mark', ms: beat(64), kind: 0, color: null },
      { id: 'later', ms: beat(80), kind: 0, color: null },
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

    it('says how many hot cues the flow brings and how many it takes away on that track, so the DJ knows what would change', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        /^1 new and 1 taken away$/,
      )
      expect(screen.queryByTestId('cue-preview-same')).toBeNull()
    })

    it('says only the part there is, so a flow that just adds does not read as taking something away', () => {
      const { unmount } = render(<CueFlowPreview flow={MY_FLOW} track={onlyMark} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(/^3 new$/)
      unmount()
      render(<CueFlowPreview flow={CALLS_ONLY} track={marked} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(/^1 taken away$/)
    })

    it('points on the wave at the hot cue the flow brings and at the one it takes away, each saying what it is', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const fresh = screen.getByTestId('cue-wave-hot-A')
      expect(fresh).toHaveAttribute('data-diff', 'new')
      expect(fresh).toHaveAccessibleName('New with this flow. The track does not have it')
      expect(hoverTooltip(fresh)).toBe('New with this flow. The track does not have it')
      const gone = screen.getByTestId(`cue-wave-ghost-gone-${beat(48)}`)
      expect(gone).toHaveTextContent(/^A$/)
      expect(gone).toHaveAccessibleName('The track has it and the flow would not place it')
      expect(hoverTooltip(gone)).toBe('The track has it and the flow would not place it')
    })

    it('counts and draws once two hot cues the track has on the same spot, and keeps neither as a cue that stays', () => {
      const twins = onTrack([
        { id: 'mark', ms: beat(64), kind: 0, color: null },
        { id: 'hot', ms: beat(48), kind: 1, color: 22 },
        { id: 'same', ms: beat(48), kind: 2, color: 42 },
        { id: 'near', ms: beat(48) + 30, kind: 3, color: 42 },
      ])
      render(<CueFlowPreview flow={ONE_AT_32} track={twins} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        /^1 new and 1 taken away$/,
      )
      expect(screen.getAllByTestId(/^cue-wave-ghost-gone-/)).toHaveLength(1)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      expect(screen.getAllByTestId(/^cue-wave-ghost-gone-/)).toHaveLength(1)
      expect(screen.queryByTestId(/^cue-wave-hot-/)).toBeNull()
    })

    it('leaves the hot cues the track keeps unmarked, so only what changes is pointed at', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={keepsOne} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(/^1 taken away$/)
      expect(screen.getByTestId('cue-wave-hot-A')).not.toHaveAttribute('data-diff')
    })

    it('fades the rest of the wave while the count is pointed at or focused, so the eye lands on the cues it counts', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const count = screen.getByTestId('cue-preview-compare')
      const wave = screen.getByTestId('cue-wave')
      expect(wave).toHaveAttribute('data-focus-diff', 'false')
      fireEvent.mouseEnter(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'true')
      fireEvent.mouseLeave(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'false')
      expect(count.tabIndex).toBe(0)
      fireEvent.focus(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'true')
      fireEvent.blur(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'false')
    })

    it('holds the fade when the count is pressed and lets go when pressed again, so the press does something and the differences can be studied without keeping the pointer still', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const count = screen.getByTestId('cue-preview-compare')
      const wave = screen.getByTestId('cue-wave')
      expect(count).toHaveAttribute('aria-pressed', 'false')
      fireEvent.mouseEnter(count)
      fireEvent.click(count)
      fireEvent.mouseLeave(count)
      expect(count).toHaveAttribute('aria-pressed', 'true')
      expect(wave).toHaveAttribute('data-focus-diff', 'true')
      fireEvent.click(count)
      expect(count).toHaveAttribute('aria-pressed', 'false')
      expect(wave).toHaveAttribute('data-focus-diff', 'false')
    })

    it('keeps the fade for a count focused by keyboard when the pointer passes over it and leaves, since the focus is still there', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const count = screen.getByTestId('cue-preview-compare')
      const wave = screen.getByTestId('cue-wave')
      fireEvent.focus(count)
      fireEvent.mouseEnter(count)
      fireEvent.mouseLeave(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'true')
      fireEvent.blur(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'false')
      fireEvent.mouseEnter(count)
      fireEvent.focus(count)
      fireEvent.blur(count)
      expect(wave).toHaveAttribute('data-focus-diff', 'true')
    })

    it('lets go of a held fade when the flow, the track or the view changes, so a new comparison never starts dimmed', () => {
      const { rerender } = render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const held = (): void => {
        fireEvent.click(screen.getByTestId('cue-preview-compare'))
        expect(screen.getByTestId('cue-wave')).toHaveAttribute('data-focus-diff', 'true')
      }
      const released = (): void => {
        expect(screen.getByTestId('cue-wave')).toHaveAttribute('data-focus-diff', 'false')
        expect(screen.getByTestId('cue-preview-compare')).toHaveAttribute('aria-pressed', 'false')
      }
      held()
      rerender(<CueFlowPreview flow={MY_FLOW} track={marked} />)
      released()
      held()
      const other = { ...marked, cues: { ...marked.cues, contentId: 'rb:9' } }
      rerender(<CueFlowPreview flow={MY_FLOW} track={other} />)
      released()
      rerender(<CueFlowPreview flow={ONE_AT_32} track={other} />)
      held()
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      released()
      held()
      fireEvent.click(screen.getByTestId('cue-preview-mode-flow'))
      released()
    })

    it('offers to see the track as it is now only when the flow would change it', () => {
      const { unmount } = render(<CueFlowPreview flow={MIX_IN} track={marked} />)
      expect(screen.queryByTestId('cue-preview-mode-now')).toBeNull()
      unmount()
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(screen.getByTestId('cue-preview-mode-flow')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('cue-preview-mode-flow')).toHaveTextContent('With the flow')
      expect(screen.getByTestId('cue-preview-mode-now')).toHaveTextContent('Now')
    })

    it('draws the hot cues the track has now with their own letters, and strikes the ones the flow would take away', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={keepsOne} />)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      expect(screen.getByTestId('cue-preview-mode-now')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('cue-wave-hot-B')).toHaveStyle({
        backgroundColor: hotCueColor(42),
      })
      expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
      expect(screen.getByTestId(`cue-wave-ghost-gone-${beat(48)}`)).toHaveTextContent(/^A$/)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        /^1 the flow would take away$/,
      )
    })

    it('rings nothing while showing the track as it is now, whatever the program calls its cues, since none of them is new', () => {
      for (const id of ['0', '1', '2', '3']) {
        const { unmount } = render(
          <CueFlowPreview
            flow={MY_FLOW}
            track={onTrack([
              { id: 'mark', ms: beat(64), kind: 0, color: null },
              { id, ms: beat(32), kind: 2, color: 42 },
            ])}
          />,
        )
        fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
        expect(screen.getByTestId('cue-wave-hot-B')).not.toHaveAttribute('data-diff')
        unmount()
      }
    })

    it('keeps the line and the switch in place when the flow takes nothing away, so nothing jumps on the way back', () => {
      render(<CueFlowPreview flow={MY_FLOW} track={onlyMark} />)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      expect(screen.getByTestId('cue-preview-status')).toHaveClass('h-10')
      expect(screen.queryByTestId('cue-preview-compare')).toBeNull()
      expect(screen.queryByTestId(/^cue-wave-hot-/)).toBeNull()
      expect(screen.getAllByTestId(/^cue-wave-call-/)).toHaveLength(1)
      fireEvent.click(screen.getByTestId('cue-preview-mode-flow'))
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(/^3 new$/)
    })

    it('hides the cues a rule leaves out while showing the track as it is now, since the track has none of them', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={twoMarks} />)
      expect(screen.getAllByTestId(/^cue-wave-ghost-dropped-/).length).toBeGreaterThan(0)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      expect(screen.queryByTestId(/^cue-wave-ghost-dropped-/)).toBeNull()
    })

    it('goes back to the flow when the track or the flow changes, so a new comparison starts from what the flow does', () => {
      const { rerender } = render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      rerender(<CueFlowPreview flow={MY_FLOW} track={marked} />)
      expect(screen.getByTestId('cue-preview-mode-flow')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      const other = { ...onlyMark, cues: { ...onlyMark.cues, contentId: 'rb:9' } }
      rerender(<CueFlowPreview flow={MY_FLOW} track={other} />)
      expect(screen.getByTestId('cue-preview-mode-flow')).toHaveAttribute('aria-pressed', 'true')
    })

    it('starts from the flow again on coming back to a flow that was left showing the track as it is now, so the view never returns on its own', () => {
      const { rerender } = render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      rerender(<CueFlowPreview flow={MY_FLOW} track={marked} />)
      rerender(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(screen.getByTestId('cue-preview-mode-flow')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('cue-preview-mode-now')).toHaveAttribute('aria-pressed', 'false')
    })

    it('hides the line about hot cues left out for lack of room while showing the track as it is now, keeping its place so the preview does not change height', () => {
      const edge = {
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
      render(<CueFlowPreview flow={edge} track={onlyMark} />)
      const leftOut = /left out by the limit of 8/
      expect(screen.getByTestId('cue-preview-status')).toHaveTextContent(leftOut)
      fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
      expect(screen.getByTestId('cue-preview-status')).not.toHaveTextContent(leftOut)
      expect(screen.getByTestId('cue-preview-status')).toHaveClass('h-10')
      expect(screen.queryByTestId(/^cue-wave-trimmed-/)).toBeNull()
      fireEvent.click(screen.getByTestId('cue-preview-mode-flow'))
      expect(screen.getByTestId('cue-preview-status')).toHaveTextContent(leftOut)
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
      expect(screen.getByTestId('cue-preview-no-mark')).toHaveTextContent(
        /^DJ Made, Millenium Stringz has no mark yet/,
      )
      expect(hoverTooltip(screen.getByTestId('cue-preview-no-mark'))).toContain(
        'Example track at 128 BPM, marked at bar 96',
      )
    })

    const edge = {
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
    const nine = {
      ...ONE_AT_32,
      rules: [8, 24, 40, 56, 72, 88, 104, 120, 136].map((bars) => ({
        ...ONE_AT_32.rules[0],
        from: 'first-beat' as const,
        direction: 'forward' as const,
        bars,
        when: 'always' as const,
      })),
    }
    const noMark = onTrack([{ id: 'hot', ms: beat(48), kind: 1, color: 22 }])

    it.each([
      ['the example track', MY_FLOW, undefined, false, 'hint'],
      ['a flow over the limit on the example track', edge, undefined, false, 'trimmed'],
      ['a flow that cannot fit', nine, undefined, false, 'too-many'],
      ['a flow that cannot fit on a marked track', nine, marked, false, 'too-many'],
      ['the same hot cues the track has', MIX_IN, marked, false, null],
      ['hot cues that change', ONE_AT_32, marked, false, 'compare'],
      ['the track as it is now', ONE_AT_32, marked, true, 'compare'],
      ['the track as it is now with nothing taken away', MY_FLOW, onlyMark, true, null],
      ['hot cues that change over the limit', edge, onlyMark, false, 'trimmed'],
      ['a track with no mark', MIX_IN, noMark, false, 'no-mark'],
    ] as const)(
      'holds one line of the same height under the wave with %s, so the rules under the preview never jump',
      (_, flow, track, now, status) => {
        render(<CueFlowPreview flow={flow} track={track} />)
        if (now) fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
        const line = screen.getByTestId('cue-preview-status')
        expect(line).toHaveClass('h-10')
        const said = Array.from(line.querySelectorAll<HTMLElement>('[data-status]'))
        expect(said.map((el) => el.dataset.status)).toEqual(status ? [status] : [])
        expect(said.every((el) => el.classList.contains('truncate'))).toBe(true)
        const outside = Array.from(screen.getByTestId('cue-flow-preview').children).filter(
          (el) => el.tagName === 'P',
        )
        expect(outside).toEqual([])
      },
    )

    it('says the most serious notice when two meet and keeps the other in its tooltip, so the line stays one line and nothing is lost', () => {
      render(<CueFlowPreview flow={edge} track={onlyMark} />)
      const line = screen.getByTestId('cue-preview-compare')
      expect(line).toHaveTextContent(/^\d+ hot cues are left out by the limit of 8$/)
      expect(hoverTooltip(line)).toMatch(/^\d+ hot cues are left out by the limit of 8\. 8 new$/)
      fireEvent.mouseEnter(line)
      expect(screen.getByTestId('cue-wave')).toHaveAttribute('data-focus-diff', 'true')
    })

    it('says a lone notice once, with no tooltip repeating it', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(hoverTooltip(screen.getByTestId('cue-preview-compare'))).toBeNull()
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
