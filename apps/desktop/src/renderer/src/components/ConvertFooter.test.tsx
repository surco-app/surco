// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionStatus } from '../lib/selectionStatus'
import type { TrackItem } from '../types'
import '../i18n'
import type { Destination } from '../lib/destination'
import { ConvertFooter } from './ConvertFooter'

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = { platform: 'linux' }
})

function status(showDone: boolean): SelectionStatus {
  return {
    showDone,
    inMusicLibraryOnly: false,
    canDeleteOriginal: false,
    musicAdding: false,
    musicAdded: false,
  } as SelectionStatus
}

function footer(showDone: boolean): React.JSX.Element {
  return (
    <ConvertFooter
      item={{ id: 't1', status: 'idle', inputPath: '/a.wav', meta: {} } as TrackItem}
      isMulti={false}
      selectedCount={1}
      status={status(showDone)}
      stale={false}
      done={showDone}
      incomplete={false}
      willEditInPlace={false}
      addToAppleMusic={false}
      addToEngineDj={false}
      destination={'beside' as Destination}
      destinations={['beside' as Destination]}
      format="aiff"
      exportedFormat={showDone ? 'aiff' : null}
      musicExt={null}
      normalizeCfg={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      onOpenNormalize={vi.fn()}
      onSelectFormat={vi.fn()}
      onSelectDestination={vi.fn()}
      onProcess={vi.fn()}
      onExportCollection={vi.fn()}
    />
  )
}

describe('ConvertFooter state swap', () => {
  // The editor remounts the footer on every track switch — stepping through a crate
  // must not replay an entrance each time. The rise is reserved for the moment the
  // footer actually changes shape: the convert button giving way to the done line.
  it('does not animate the state block on mount, even when already done', () => {
    render(footer(true))
    expect(screen.getByTestId('footer-state').className).not.toContain('animate-footer-swap')
  })

  it('animates the state block in when convert flips to done', () => {
    const { rerender } = render(footer(false))
    rerender(footer(true))
    expect(screen.getByTestId('footer-state').className).toContain('animate-footer-swap')
  })
})

// Reported 14/09 with a screenshot in French: the row of footer buttons shares its width
// evenly (flex-1), so a label longer than its share wrapped and the button grew to two
// lines while its neighbours stayed at one — a ragged row. The labels are translated, so
// no length is safe; the row has to hold one line whatever the language puts in it.
describe('ConvertFooter buttons stay on one line', () => {
  it('never wraps the export label', () => {
    render(footer(true))
    expect(screen.getByTestId('export-collection').className).toContain('whitespace-nowrap')
  })

  // Not wrapping alone would push the button wider than its share and squeeze the others;
  // the overflow has to resolve as an ellipsis inside the button.
  it('truncates the export label rather than widening the row', () => {
    render(footer(true))
    expect(screen.getByTestId('export-collection').className).toContain('truncate')
  })
})
