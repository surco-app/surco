// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALLS_ONLY, MIX_IN, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { DjProgram } from '../../../shared/djProgram'
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

  it('takes no inset of its own, so its selector, wave and status line start where the piece that holds it says, which is where the room for the ring of a new cue at the very start comes from', () => {
    render(<CueFlowPreview flow={MY_FLOW} />)
    expect(screen.getByTestId('cue-flow-preview').className).not.toMatch(/(?<![\w-])p[xlr]?-/)
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

  it('says in French the hot cues left out by the limit in no more letters than in Spanish, whose line fits beside the switch, so the French one is not cut', async () => {
    await i18n.changeLanguage('fr')
    try {
      for (const count of [1, 12]) {
        const french = i18n.t('editor.cues.trimmed', { count })
        expect(french).toContain(`${count} hot cue`)
        expect(french).toContain('limite de 8')
        expect(french.length).toBeLessThanOrEqual(
          i18n.t('editor.cues.trimmed', { count, lng: 'es' }).length,
        )
      }
    } finally {
      await i18n.changeLanguage('en')
    }
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

  it('scrolls Settings down again when the tracks land and the list grows past the bottom edge, so the collection just read is not hidden under it', () => {
    const boxes: Record<string, { top: number; bottom: number }> = {
      scroller: { top: 0, bottom: 300 },
      'cue-preview-track-menu': { top: 200, bottom: 290 },
    }
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const { top, bottom } = boxes[this.dataset.testid ?? ''] ?? { top: 0, bottom: 0 }
        return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect
      })
    try {
      const { rerender } = render(
        <div data-testid="scroller" style={{ overflowY: 'auto' }}>
          <CueFlowPreview flow={MIX_IN} loading />
        </div>,
      )
      fireEvent.click(screen.getByTestId('cue-preview-track'))
      expect(screen.getByTestId('scroller').scrollTop).toBe(0)
      boxes['cue-preview-track-menu'] = { top: 200, bottom: 466 }
      rerender(
        <div data-testid="scroller" style={{ overflowY: 'auto' }}>
          <CueFlowPreview flow={MIX_IN} tracks={[{ contentId: 'rb:3', label: 'Glue' }]} />
        </div>,
      )
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
      expect(gone.textContent).toBe('')
      expect(gone).toHaveAccessibleName('The track has A and the flow would not place it')
      expect(hoverTooltip(gone)).toBe('The track has A and the flow would not place it')
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

    it('underlines the count while its fade is held, so a pressed count looks pressed, without growing or moving its text, and gives its focus ring some air', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      const count = screen.getByTestId('cue-preview-compare')
      expect(count).toHaveClass('aria-pressed:underline', 'underline-offset-2')
      expect(count).toHaveClass('-mx-1', 'px-1', 'rounded')
      const resting = count.className
      fireEvent.click(count)
      expect(count).toHaveAttribute('aria-pressed', 'true')
      expect(count.className).toBe(resting)
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
      expect(screen.getByTestId(`cue-wave-ghost-gone-${beat(48)}`)).toHaveAccessibleName(
        'The track has A and the flow would not place it',
      )
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

    describe('without a mark of its own, as in the programs with no CALLs', () => {
      const hotOnly = onTrack([{ id: 'hot', ms: beat(48), kind: 1, color: 22 }])
      const POINTS = [beat(64)]

      it('hangs the flow from the points Auto mark finds and draws each as a ring that says so, so the DJ sees the flow on their own track and knows the mark is a guess of Surco', () => {
        render(<CueFlowPreview flow={ONE_AT_32} track={hotOnly} points={POINTS} />)
        expect(screen.getByTestId('cue-preview-track')).toHaveTextContent(
          'DJ Made, Millenium Stringz',
        )
        const found = screen.getByTestId(`cue-wave-call-${beat(64)}`)
        expect(found).toHaveAttribute('data-auto', 'true')
        expect(found).toHaveAccessibleName('Point found by Auto mark')
        expect(hoverTooltip(found)).toBe('Point found by Auto mark')
        expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-diff', 'new')
        expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
          /^1 new and 1 taken away$/,
        )
        expect(screen.queryByTestId('cue-preview-no-mark')).toBeNull()
      })

      it('compares with the hot cues the track has as it does on a marked track, the green dot and the look at the track as it is now included, where no ring is drawn since the track has no such mark', () => {
        const { unmount } = render(<CueFlowPreview flow={MIX_IN} track={hotOnly} points={POINTS} />)
        expect(screen.getByTestId('cue-preview-same')).toBeInTheDocument()
        unmount()
        render(<CueFlowPreview flow={ONE_AT_32} track={hotOnly} points={POINTS} />)
        fireEvent.click(screen.getByTestId('cue-preview-mode-now'))
        expect(screen.getByTestId(`cue-wave-ghost-gone-${beat(48)}`)).toBeInTheDocument()
        expect(screen.queryByTestId(/^cue-wave-call-/)).toBeNull()
      })

      it('tells whoever makes a flow from the track which marks it is shown with, so the flow counts from the same points the DJ is looking at', () => {
        const onShown = vi.fn()
        render(<CueFlowPreview flow={MIX_IN} track={hotOnly} points={POINTS} onShown={onShown} />)
        expect(onShown).toHaveBeenLastCalledWith({
          label: hotOnly.label,
          cues: hotOnly.cues,
          marks: POINTS,
        })
      })

      it('draws the marks of the DJ as always on a track that has them, whatever points come with it, so a found point never replaces a mark', () => {
        const onShown = vi.fn()
        render(
          <CueFlowPreview flow={MIX_IN} track={marked} points={[beat(80)]} onShown={onShown} />,
        )
        expect(screen.queryByTestId(`cue-wave-call-${beat(80)}`)).toBeNull()
        expect(screen.getByTestId(`cue-wave-call-${beat(64)}`)).not.toHaveAttribute('data-auto')
        expect(onShown).toHaveBeenLastCalledWith({ label: marked.label, cues: marked.cues })
      })

      it('shows the wave of the track with the cues it has and says it is finding its points while it is, in the same line under the wave, so nothing jumps when they land', () => {
        const onShown = vi.fn()
        const { rerender } = render(
          <CueFlowPreview flow={ONE_AT_32} track={hotOnly} finding onShown={onShown} />,
        )
        expect(screen.getByTestId('cue-preview-track')).toHaveTextContent(
          'DJ Made, Millenium Stringz',
        )
        const line = screen.getByTestId('cue-preview-status')
        expect(line).toHaveClass('h-10')
        const said = screen.getByTestId('cue-preview-finding')
        expect(said).toHaveAttribute('role', 'status')
        expect(said).toHaveTextContent(/^Finding the points of the track…$/)
        expect(said).toHaveClass('truncate')
        expect(said.querySelector('svg')).toHaveClass('animate-spin')
        expect(
          Array.from(line.querySelectorAll<HTMLElement>('[data-status]')).map(
            (el) => el.dataset.status,
          ),
        ).toEqual(['finding'])
        expect(screen.getByTestId('cue-wave-hot-A')).not.toHaveAttribute('data-diff')
        expect(screen.queryByTestId(/^cue-wave-call-/)).toBeNull()
        expect(screen.queryByTestId(/^cue-wave-ghost-/)).toBeNull()
        expect(screen.queryByTestId('cue-preview-mode-now')).toBeNull()
        expect(onShown).toHaveBeenLastCalledWith(null)
        rerender(
          <CueFlowPreview flow={ONE_AT_32} track={hotOnly} points={POINTS} onShown={onShown} />,
        )
        expect(screen.queryByTestId('cue-preview-finding')).toBeNull()
        expect(screen.getByTestId('cue-preview-status')).toHaveClass('h-10')
        expect(screen.getByTestId(`cue-wave-call-${beat(64)}`)).toHaveAttribute('data-auto', 'true')
      })

      it('goes back to the example track with the line that says why once no point was found', () => {
        const { rerender } = render(<CueFlowPreview flow={MIX_IN} track={hotOnly} finding />)
        rerender(<CueFlowPreview flow={MIX_IN} track={hotOnly} />)
        expect(screen.getByTestId('cue-preview-no-mark')).toHaveTextContent(
          /^DJ Made, Millenium Stringz has no mark yet/,
        )
        expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
      })
    })

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

    it('draws no search field, no separator and no line under the example when there is no marked track to look for, since a field that finds nothing reads as broken and a line about what is missing is noise', () => {
      render(<CueFlowPreview flow={MY_FLOW} />)
      open()
      expect(screen.queryByTestId('cue-preview-track-search')).toBeNull()
      expect(screen.queryByTestId('cue-preview-track-separator')).toBeNull()
      expect(screen.queryByTestId('cue-preview-track-empty')).toBeNull()
      expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull()
      expect(screen.getByTestId('cue-preview-track-menu')).toHaveTextContent(/^Example track$/)
    })

    it('puts the focus on the example when there is no search field to take it, so Escape and the arrows still answer from the keyboard', () => {
      const reached = vi.fn()
      window.addEventListener('keydown', reached)
      render(<CueFlowPreview flow={MY_FLOW} />)
      open()
      const example = screen.getByTestId('cue-preview-track-option-example')
      expect(example).toHaveFocus()
      fireEvent.keyDown(example, { key: 'ArrowDown' })
      fireEvent.keyDown(example, { key: 'ArrowUp' })
      expect(example).toHaveFocus()
      fireEvent.keyDown(example, { key: 'Escape' })
      window.removeEventListener('keydown', reached)
      expect(screen.queryByTestId('cue-preview-track-listbox')).toBeNull()
      expect(screen.getByTestId('cue-preview-track')).toHaveFocus()
      expect(reached).not.toHaveBeenCalled()
    })

    it('gives the focus to the search field once the collection has marked tracks, so a name can be typed at once', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
      expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull()
    })

    it('tells whoever reads the collection each time the choices open and close, so the read can wait for the first look', () => {
      const onOpenChange = vi.fn()
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} onOpenChange={onOpenChange} />)
      expect(onOpenChange).not.toHaveBeenCalled()
      open()
      expect(onOpenChange.mock.calls).toEqual([[true]])
      fireEvent.mouseDown(document.body)
      expect(onOpenChange.mock.calls).toEqual([[true], [false]])
      open()
      fireEvent.keyDown(screen.getByTestId('cue-preview-track-search'), { key: 'Escape' })
      open()
      fireEvent.click(screen.getByTestId('cue-preview-track-option-rb:3'))
      expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false], [true], [false]])
    })

    it('draws a row as tall as a choice that says the collection is being read, with the search field already there and the example still to pick, so nothing moves when the tracks land', () => {
      const { rerender } = render(<CueFlowPreview flow={MY_FLOW} loading />)
      open()
      const loading = screen.getByTestId('cue-preview-track-loading')
      expect(loading).toHaveAttribute('role', 'status')
      expect(loading).toHaveAccessibleName('Reading your collection…')
      expect(loading).toHaveClass('h-7')
      expect(loading.querySelector('svg')).toHaveClass('animate-spin')
      expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
      expect(screen.getByTestId('cue-preview-track-search')).toBeEnabled()
      expect(screen.getByTestId('cue-preview-track-separator')).toBeInTheDocument()
      expect(
        screen.getByTestId('cue-preview-track-option-example').compareDocumentPosition(loading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'gl' } })
      expect(screen.queryByTestId('cue-preview-track-empty')).toBeNull()
      rerender(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Example track',
        'Bicep, Glue',
      ])
    })

    it('moves the focus to the example when the collection turns out to have no marked track and the search field goes, so the keyboard is not left on nothing', () => {
      const { rerender } = render(<CueFlowPreview flow={MY_FLOW} loading />)
      open()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
      rerender(<CueFlowPreview flow={MY_FLOW} />)
      expect(screen.queryByTestId('cue-preview-track-search')).toBeNull()
      expect(screen.queryByTestId('cue-preview-track-separator')).toBeNull()
      expect(screen.getByTestId('cue-preview-track-option-example')).toHaveFocus()
    })

    it('lets the example be picked while the collection is still being read', () => {
      render(<CueFlowPreview flow={MY_FLOW} loading />)
      open()
      fireEvent.click(screen.getByTestId('cue-preview-track-option-example'))
      expect(screen.queryByTestId('cue-preview-track-menu')).toBeNull()
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
    })

    it('offers the example first and the tracks of the collection under it, so any of them can be tried', () => {
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
        'Search your rekordbox collection',
      )
      expect(screen.getByTestId('cue-preview-track-search')).toHaveAccessibleName(
        'Search your rekordbox collection',
      )
    })

    it('names in the search field the program whose collection it searches, so a DJ with Traktor is not told it is rekordbox', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} program="traktor" />)
      open()
      expect(screen.getByTestId('cue-preview-track-search')).toHaveAttribute(
        'placeholder',
        'Search your Traktor collection',
      )
      expect(screen.getByTestId('cue-preview-track-search')).toHaveAccessibleName(
        'Search your Traktor collection',
      )
    })

    describe('with several programs', () => {
      const THREE: DjProgram[] = ['rekordbox', 'traktor', 'engine']
      function Programs(): React.JSX.Element {
        const [program, setProgram] = useState<DjProgram>('rekordbox')
        return (
          <CueFlowPreview
            flow={MY_FLOW}
            tracks={LIST}
            programs={THREE}
            program={program}
            onProgram={setProgram}
          />
        )
      }
      const radio = (program: DjProgram): HTMLElement =>
        screen.getByTestId(`cue-preview-program-${program}`)

      it('draws one button per program sharing the width of the row, each with the same classes chosen or not, so choosing one never resizes the others', () => {
        render(<Programs />)
        open()
        const row = screen.getByRole('radiogroup')
        expect(row).toHaveAccessibleName('Program')
        const all = within(row).getAllByRole('radio')
        expect(all.map((r) => r.textContent)).toEqual(['rekordbox', 'Traktor', 'Engine DJ'])
        for (const r of all) expect(r).toHaveClass('press', 'flex-1', 'min-w-0', 'truncate')
        const resting = radio('traktor').className
        fireEvent.click(radio('traktor'))
        expect(radio('traktor')).toHaveAttribute('aria-checked', 'true')
        expect(radio('traktor').className).toBe(resting)
        expect(radio('rekordbox').className).toBe(resting)
      })

      it('draws no row for a single program, since there is nothing to choose', () => {
        render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} programs={['traktor']} />)
        open()
        expect(screen.queryByRole('radiogroup')).toBeNull()
      })

      it('opens with the focus on the search field and the chosen program as the only stop of the row, so Tab crosses it in one step', () => {
        render(<Programs />)
        open()
        expect(screen.getByTestId('cue-preview-track-search')).toHaveFocus()
        expect(THREE.map((p) => radio(p).tabIndex)).toEqual([0, -1, -1])
      })

      it('moves between the programs with the left and right arrows, the focus following the choice and going round at the ends, so the row is walked without leaving it', () => {
        render(<Programs />)
        open()
        radio('rekordbox').focus()
        fireEvent.keyDown(radio('rekordbox'), { key: 'ArrowRight' })
        expect(radio('traktor')).toHaveAttribute('aria-checked', 'true')
        expect(radio('traktor')).toHaveFocus()
        fireEvent.keyDown(radio('traktor'), { key: 'ArrowRight' })
        expect(radio('engine')).toHaveFocus()
        fireEvent.keyDown(radio('engine'), { key: 'ArrowRight' })
        expect(radio('rekordbox')).toHaveAttribute('aria-checked', 'true')
        expect(radio('rekordbox')).toHaveFocus()
        fireEvent.keyDown(radio('rekordbox'), { key: 'ArrowLeft' })
        expect(radio('engine')).toHaveAttribute('aria-checked', 'true')
        expect(radio('engine')).toHaveFocus()
      })

      it('hands the focus to the search field when a program is clicked, emptying what was typed for the other collection', () => {
        render(<Programs />)
        open()
        const search = screen.getByTestId('cue-preview-track-search')
        fireEvent.change(search, { target: { value: 'zzz' } })
        radio('traktor').focus()
        fireEvent.click(radio('traktor'))
        expect(search).toHaveFocus()
        expect(search).toHaveValue('')
        expect(search).toHaveAttribute('placeholder', 'Search your Traktor collection')
      })

      it('goes down from a program into the choices and closes on Escape from it without the press reaching Settings', () => {
        const reached = vi.fn()
        window.addEventListener('keydown', reached)
        render(<Programs />)
        open()
        radio('rekordbox').focus()
        fireEvent.keyDown(radio('rekordbox'), { key: 'ArrowDown' })
        expect(screen.getByTestId('cue-preview-track-option-example')).toHaveFocus()
        radio('rekordbox').focus()
        fireEvent.keyDown(radio('rekordbox'), { key: 'Escape' })
        window.removeEventListener('keydown', reached)
        expect(screen.queryByTestId('cue-preview-track-menu')).toBeNull()
        expect(screen.getByTestId('cue-preview-track')).toHaveFocus()
        expect(reached).not.toHaveBeenCalled()
      })
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

    it('shows the artist beside each track and finds a track by it, since a whole collection repeats titles', () => {
      const twins = [
        { contentId: 'rb:2', label: 'Intro', artist: 'Âme' },
        { contentId: 'rb:3', label: 'Intro', artist: 'Bicep' },
      ]
      render(<CueFlowPreview flow={MY_FLOW} tracks={twins} />)
      open()
      expect(screen.getByTestId('cue-preview-track-artist-rb:2')).toHaveTextContent('Âme')
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'bic' } })
      expect(screen.getByTestId('cue-preview-track-option-rb:3')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-preview-track-option-rb:2')).toBeNull()
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

    it('says no track has that name instead of leaving the choices blank, without calling the tracks marked now that every one is offered', () => {
      render(<CueFlowPreview flow={MY_FLOW} tracks={LIST} />)
      open()
      fireEvent.change(screen.getByTestId('cue-preview-track-search'), { target: { value: 'zzz' } })
      expect(screen.getByTestId('cue-preview-track-empty')).toHaveTextContent(
        /^No track with that name$/,
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
