// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { Destination } from '../lib/destination'
import type { SelectionStatus } from '../lib/selectionStatus'
import type { TrackItem } from '../types'
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
  // The full reason can list every required field; its short form goes on the main
  // button's face, so the footer stays one control tall and the button keeps its width.
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

// Reported 29/09 with a screenshot: once converted, the footer spent two rows on "Added to
// Apple Music" plus three equal buttons, and the first of them, "Show in Apple Music", only
// restated the green line above it. Revealing a copy that is already in sync is a look at
// the result, not a next step, so it rides the outcome line; the action row keeps only what
// still changes something.
describe('ConvertFooter done layout', () => {
  function inMusic(libraryOnly: boolean, added: boolean): React.JSX.Element {
    return (
      <ConvertFooter
        {...footer(true).props}
        item={
          {
            id: 't1',
            status: 'done',
            inputPath: '/a.wav',
            meta: {},
            musicPersistentId: 'ABCD1234',
          } as TrackItem
        }
        status={{ ...status(true), inMusicLibraryOnly: libraryOnly, musicAdded: added }}
      />
    )
  }

  beforeEach(() => {
    ;(window as unknown as { api: Record<string, unknown> }).api = { platform: 'darwin' }
  })

  it('puts the reveal of a synced Apple Music copy on the outcome line', () => {
    render(inMusic(false, true))
    const outcome = screen.getByTestId('done-outcome')
    expect(within(outcome).getByTestId('add-apple-music')).toHaveAccessibleName(
      'Show in Apple Music',
    )
    expect(within(screen.getByTestId('done-actions')).queryByTestId('add-apple-music')).toBeNull()
  })

  // "Added to Apple Music · Show ↗" still spent two items on one fact: where the track now
  // lives. When the confirmation already names the library, the confirmation is the way there.
  it('makes the confirmation itself the reveal when it already names Apple Music', () => {
    const revealAppleMusic = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      platform: 'darwin',
      revealAppleMusic,
    }
    render(inMusic(true, true))
    const reveal = within(screen.getByRole('status')).getByTestId('add-apple-music')
    expect(reveal).toHaveAccessibleName('✓ Added to Apple Music · Show in Apple Music')
    expect(screen.getByTestId('done-outcome').textContent?.match(/Apple Music/g)).toHaveLength(1)
    fireEvent.click(reveal)
    expect(revealAppleMusic).toHaveBeenCalledWith('ABCD1234')
  })

  it('keeps an update that is still pending among the actions', () => {
    render(inMusic(false, false))
    expect(
      within(screen.getByTestId('done-actions')).getByTestId('add-apple-music'),
    ).toHaveTextContent('Update in Apple Music')
  })
})

// A target typed with a decimal (-14.5 LUFS) went into the note above the button as the
// raw number, so a Spanish UI read "-14.5 LUFS" beside copy that writes "-14,5".
describe('ConvertFooter normalize note', () => {
  it('writes a decimal target with the mark of the app language', async () => {
    await i18n.changeLanguage('es')
    try {
      render(
        cloneElement(footer(false), {
          normalizeCfg: { mode: 'loudness', targetLufs: -14.5, truePeakDb: -1, peakDb: -1 },
        }),
      )
      expect(screen.getByTestId('convert-normalize-note')).toHaveTextContent('-14,5 LUFS')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
