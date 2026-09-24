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

function footer(
  showDone: boolean,
  incompleteReason?: string,
  incompleteSummary?: string,
): React.JSX.Element {
  return (
    <ConvertFooter
      item={{ id: 't1', status: 'idle', inputPath: '/a.wav', meta: {} } as TrackItem}
      isMulti={false}
      selectedCount={1}
      status={status(showDone)}
      stale={false}
      done={showDone}
      incomplete={incompleteReason !== undefined}
      incompleteReason={incompleteReason}
      incompleteSummary={incompleteSummary}
      willEditInPlace={false}
      tagsOnly={false}
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

  // The swap replaces the button the keyboard user pressed, so focus fell to <body> the
  // moment the conversion finished and the next Tab started over from the window's top.
  // It has to land on the new state's convert button instead.
  it('keeps keyboard focus in the footer when convert flips to done', () => {
    const { rerender } = render(footer(false))
    screen.getByTestId('process-btn').focus()
    rerender(footer(true))
    expect(screen.getByTestId('process-btn')).toHaveFocus()
  })

  // Focus that was elsewhere (the metadata form) must stay there: the footer only restores
  // what its own swap took away.
  it('leaves focus alone when it was outside the footer', () => {
    const { rerender } = render(
      <>
        <input data-testid="elsewhere" />
        {footer(false)}
      </>,
    )
    screen.getByTestId('elsewhere').focus()
    rerender(
      <>
        <input data-testid="elsewhere" />
        {footer(true)}
      </>,
    )
    expect(screen.getByTestId('elsewhere')).toHaveFocus()
  })
})

// The outcome of a conversion only showed up as coloured text in the footer; a screen reader
// user who pressed Convert heard nothing when it finished or failed. Success is a polite
// status, a failure an assertive alert.
describe('ConvertFooter announcements', () => {
  it('announces a finished conversion as a status', () => {
    render(footer(true))
    expect(screen.getByRole('status')).toBe(screen.getByTestId('export-success'))
  })

  it('announces a failed conversion as an alert', () => {
    render(
      <ConvertFooter
        {...footer(false).props}
        item={
          {
            id: 't1',
            status: 'error',
            error: 'Disk full',
            inputPath: '/a.wav',
            meta: {},
          } as TrackItem
        }
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
  })

  it('announces a failed Apple Music add as an alert', () => {
    render(
      <ConvertFooter
        {...footer(true).props}
        status={{ ...status(true), musicError: 'Music is not running' }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Music is not running')
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

describe('ConvertFooter blocked by missing fields', () => {
  // The full reason can list every required field; the main button carries the short form
  // on its face, so the footer stays one control tall.
  it('puts the short form of what is missing on the main button', () => {
    render(
      footer(
        false,
        'Missing required fields: Title, Artist, Year, Genre, Grouping, Album',
        '6 required fields missing',
      ),
    )
    expect(screen.getByTestId('process-btn')).toHaveTextContent('6 required fields missing')
  })

  it('keeps the action on the button when the track is ready to convert', () => {
    render(footer(false))
    expect(screen.getByTestId('process-btn')).not.toHaveTextContent('missing')
  })
})
