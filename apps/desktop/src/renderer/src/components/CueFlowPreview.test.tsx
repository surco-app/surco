// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
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
})
