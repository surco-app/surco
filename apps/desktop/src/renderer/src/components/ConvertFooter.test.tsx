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
