// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MIX_IN, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
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
    expect(screen.getAllByTestId(/^cue-wave-ghost-dropped-/)).toHaveLength(1)
    expect(screen.getByTestId('cue-preview-left-out')).toHaveTextContent(
      'Rule 1, 16 bars back. Inside a chorus',
    )
  })

  it('says nothing about left out cues when the flow places every one', () => {
    render(<CueFlowPreview flow={ONE_AT_32} />)
    expect(screen.queryByTestId('cue-preview-left-out')).toBeNull()
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
      expect(screen.getByTestId('cue-preview-source-track')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        'Same hot cues this track has now',
      )
    })

    it('counts the hot cues the flow would add or take away on that track', () => {
      render(<CueFlowPreview flow={ONE_AT_32} track={marked} />)
      expect(screen.getByTestId('cue-preview-compare')).toHaveTextContent(
        '2 hot cues differ from what this track has now',
      )
    })

    it('goes back to the example track on request', () => {
      render(<CueFlowPreview flow={MIX_IN} track={marked} />)
      fireEvent.click(screen.getByTestId('cue-preview-source-example'))
      expect(screen.getByText('Example track at 128 BPM, marked at bar 96')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-preview-compare')).toBeNull()
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
})
