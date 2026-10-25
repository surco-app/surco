// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CuePhraseBand } from './CuePhraseBand'

afterEach(cleanup)

const SECTIONS = [
  { ms: 0, label: 'Intro', kind: 'intro' as const },
  { ms: 10000, label: 'Chorus', kind: 'chorus' as const },
  { ms: 15000, label: 'Chorus', kind: 'chorus' as const },
  { ms: 30000, label: 'Outro', kind: 'outro' as const },
]

describe('CuePhraseBand', () => {
  it('lays each stretch of one phrase as one block from its start to the next phrase, the last running to the end of the track', () => {
    render(<CuePhraseBand sections={SECTIONS} durationMs={40000} />)
    const blocks = screen.getAllByTestId('cue-phrase')
    expect(blocks.map((b) => [b.style.left, b.style.width])).toEqual([
      ['0%', '25%'],
      ['25%', '50%'],
      ['75%', '25%'],
    ])
    expect(blocks.map((b) => b.dataset.kind)).toEqual(['intro', 'chorus', 'outro'])
    expect(blocks.map((b) => b.textContent)).toEqual(['Intro', 'Chorus', 'Outro'])
  })

  it('leaves a phrase too short for its name unlabelled, so no clipped "D…" sits in the band', () => {
    render(
      <CuePhraseBand
        sections={[
          { ms: 0, label: 'Up', kind: 'up' },
          { ms: 20000, label: 'Down', kind: 'down' },
          { ms: 20500, label: 'Chorus', kind: 'chorus' },
        ]}
        durationMs={40000}
      />,
    )
    expect(screen.getAllByTestId('cue-phrase').map((b) => b.textContent)).toEqual([
      'Up',
      '',
      'Chorus',
    ])
  })

  it('draws nothing for a track rekordbox gave no phrases, so no empty strip sits under the overview', () => {
    const { container } = render(<CuePhraseBand sections={[]} durationMs={40000} />)
    expect(container).toBeEmptyDOMElement()
  })
})
