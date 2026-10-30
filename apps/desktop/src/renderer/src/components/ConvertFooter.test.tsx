// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type PlaceCheck, verificationStatus } from '../../../shared/verification'
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
      spectrum={undefined}
      isMulti={false}
      selectedCount={1}
      outputFolder=""
      status={status(showDone)}
      stale={false}
      done={showDone}
      incomplete={incompleteReason !== undefined}
      incompleteReason={incompleteReason}
      incompleteSummary={incompleteSummary}
      willEditInPlace={false}
      tagsOnly={false}
      addToAppleMusic={false}
      djTargets={[]}
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
  // It has to land on the new state's "•••" instead, the menu that holds Convert again.
  it('keeps keyboard focus in the footer when convert flips to done', () => {
    const { rerender } = render(footer(false))
    screen.getByTestId('process-btn').focus()
    rerender(footer(true))
    expect(screen.getByTestId('done-more')).toHaveFocus()
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

  // Conversion errors run to 200+ characters, and the part that says what to do comes
  // last. Cut to one line with nothing to hover, the user could not read the fix.
  it('keeps the whole conversion error readable when it does not fit', () => {
    const error =
      'Apple Music could not copy the file into its media folder. Turn on "Copy files to Music Media folder" in Music settings and convert again.'
    render(
      <ConvertFooter
        {...footer(false).props}
        item={{ id: 't1', status: 'error', error, inputPath: '/a.wav', meta: {} } as TrackItem}
      />,
    )
    expect(screen.getByRole('alert')).toHaveAttribute('title', error)
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

// Reported 14/09 with a screenshot in French: a translated label longer than its share
// wrapped and left a ragged row. Reported again 04/10: with "Clean up the previous file" the
// converted footer broke into two misaligned lines, and centring each line was no better.
// The user wants it on one line, always, so everything past the outcome is an icon named by
// its tooltip and accessible label: no translation can push it onto a second line.
describe('ConvertFooter done footer stays on one line', () => {
  it('never lets the row wrap', () => {
    render(footer(true))
    expect(screen.getByTestId('done-row').className).not.toContain('flex-wrap')
  })

  // Redesigned 15/10 after macOS: a bare ↻ read as "reload" and a disc as nothing at all,
  // so the follow-ups moved into a menu where each one is a full phrase. The row keeps one
  // icon for all of them, and no translation can widen it.
  it('gathers the follow-up actions in one menu where each says what it does', () => {
    render(footer(true))
    const more = screen.getByTestId('done-more')
    expect(more).toHaveAccessibleName('More actions')
    expect(screen.queryByTestId('process-btn')).toBeNull()
    fireEvent.click(more)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Convert again')
    expect(screen.getByTestId('export-collection')).toHaveTextContent('Export to DJ app…')
  })

  it('offers the file from the menu by name', () => {
    render(
      <ConvertFooter
        {...footer(true).props}
        status={{ ...status(true), revealPath: '/crate/a.aiff' }}
      />,
    )
    expect(screen.queryByTestId('show-file')).toBeNull()
    fireEvent.click(screen.getByTestId('done-more'))
    expect(screen.getByTestId('show-file')).toHaveTextContent('Show file')
  })

  // Picking a format only relabels "Convert again", so the menu has to stay open for the
  // user to see that and press it; closing on the pick hid the one place it shows.
  it('keeps the menu open while a format is picked', () => {
    const onSelectFormat = vi.fn()
    render(<ConvertFooter {...footer(true).props} onSelectFormat={onSelectFormat} />)
    fireEvent.click(screen.getByTestId('done-more'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onSelectFormat).toHaveBeenCalledWith('mp3')
    expect(screen.getByTestId('process-btn')).toBeInTheDocument()
  })

  // A file left behind is the step most often forgotten after a replace, so its button says
  // what it removes instead of hiding behind a trash can.
  it('names the clean-up of the previous file on its button', () => {
    render(
      <ConvertFooter
        {...footer(true).props}
        status={{ ...status(true), canDeleteOriginal: true }}
      />,
    )
    expect(screen.getByTestId('clean-up-previous')).toHaveTextContent('Clean up the previous file')
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

  // Reported 02/10 with two screenshots: the same "send to Apple Music" read "Added to Apple
  // Music ↗" on one track and "Exported as AIFF · Show in Apple Music · Show file" over two
  // rows on another. The second was an AIFF updated in place, so a file stayed behind, but
  // the user sent it to their library: the folder is where it came from, not where it went.
  function sentToMusic(destination: Destination, isMulti = false): React.JSX.Element {
    return (
      <ConvertFooter
        {...inMusic(false, true).props}
        isMulti={isMulti}
        selectedCount={isMulti ? 9 : 1}
        destination={destination}
        status={{
          ...status(true),
          revealPath: '/crate/a.aiff',
          musicAdded: true,
          superseded: [],
        }}
      />
    )
  }

  it('reads an in-place export sent to Apple Music as added there, with no file to show', () => {
    render(sentToMusic('appleMusic'))
    expect(screen.getByRole('status')).toHaveTextContent('✓ Added to Apple Music')
    expect(screen.queryByTestId('show-file')).toBeNull()
  })

  it('counts a batch sent to Apple Music as added there, with no file to show', () => {
    render(sentToMusic('appleMusic', true))
    expect(screen.getByRole('status')).toHaveTextContent('✓ 9 tracks added to Apple Music')
    expect(screen.queryByTestId('show-file')).toBeNull()
  })

  it('still shows the file when the destination is a folder', () => {
    render(sentToMusic('folder'))
    expect(screen.getByRole('status')).toHaveTextContent('Exported as AIFF')
    fireEvent.click(screen.getByTestId('done-more'))
    expect(screen.getByTestId('show-file')).toBeInTheDocument()
  })

  // The one step still left is the only filled button, and it wears its name: a tinted
  // music note said "update" only to whoever hovered it.
  it('makes an update that is still pending the named main action', () => {
    render(inMusic(false, false))
    expect(
      within(screen.getByTestId('done-actions')).getByTestId('add-apple-music'),
    ).toHaveTextContent('Update in Apple Music')
  })

  // Reported in the UX audit: a track converted to the output folder came back with "Add to
  // Apple Music" as the filled button, pushing the library the DJ had just chosen not to use.
  function convertedTo(destination: Destination, cleanUp = false): React.JSX.Element {
    return (
      <ConvertFooter
        {...footer(true).props}
        musicExt="aiff"
        destination={destination}
        status={{ ...status(true), canDeleteOriginal: cleanUp }}
      />
    )
  }

  it('offers Apple Music only as a secondary step after converting to a folder', () => {
    render(convertedTo('folder'))
    expect(
      within(screen.getByTestId('done-actions')).getByTestId('add-apple-music'),
    ).toHaveAttribute('data-variant', 'secondary')
  })

  it('keeps the Apple Music add the main action when Apple Music is the destination', () => {
    render(convertedTo('appleMusic'))
    expect(
      within(screen.getByTestId('done-actions')).getByTestId('add-apple-music'),
    ).toHaveAttribute('data-variant', 'primary')
  })

  // The trash sat flush against the next step, one slip from a delete prompt instead of it.
  it('sets the clean-up apart from the next steps', () => {
    render(convertedTo('folder', true))
    const divider = screen.getByTestId('done-divider')
    expect(
      screen.getByTestId('clean-up-previous').compareDocumentPosition(divider) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      divider.compareDocumentPosition(screen.getByTestId('done-actions')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // A finished add leaves nothing to do: the green line already says so and leads there.
  it('drops the Apple Music button once the selection was added', () => {
    render(
      <ConvertFooter
        {...footer(true).props}
        isMulti
        selectedCount={3}
        musicExt="aiff"
        status={{ ...status(true), musicAdded: true, superseded: [] }}
      />,
    )
    expect(within(screen.getByTestId('done-actions')).queryByTestId('add-apple-music')).toBeNull()
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

describe('ConvertFooter library reveal', () => {
  // The DJ picked rekordbox playlists for the track to set its cues there next; once the
  // track has reached rekordbox, the footer takes them to it instead of a hunt through tabs.
  it('takes the DJ to each library the track reached, named for the library', () => {
    const onRevealIn = vi.fn()
    render(cloneElement(footer(true), { revealIn: ['rekordbox'], onRevealIn }))
    const reveal = within(screen.getByTestId('done-outcome')).getByTestId('reveal-in-rekordbox')
    expect(reveal).toHaveAccessibleName('Show in rekordbox')
    fireEvent.click(reveal)
    expect(onRevealIn).toHaveBeenCalledWith('rekordbox')
  })

  it('offers no library the track has not reached', () => {
    render(cloneElement(footer(true), { revealIn: [], onRevealIn: vi.fn() }))
    expect(screen.queryByTestId('reveal-in-rekordbox')).toBeNull()
  })
})

describe('ConvertFooter lossy source note', () => {
  function converting(
    inputPath: string,
    format: 'aiff' | 'mp3',
    spectrum?: TrackItem['spectrum'],
  ): React.JSX.Element {
    return cloneElement(footer(false), {
      item: { id: 't1', status: 'idle', inputPath, meta: {} } as TrackItem,
      spectrum,
      format,
    })
  }
  const cut = (cutoffHz: number): TrackItem['spectrum'] =>
    ({ image: '', cutoffHz, sampleRateHz: 44100, processed: false }) as TrackItem['spectrum']

  // A 1.2 MB MP3 came out a 5.3 MB AIFF without a word: a lossless container looks like an
  // upgrade, and the DJ deserves to know it is only a bigger copy of the same audio.
  it('says a lossy source converted to a lossless format keeps its quality', () => {
    render(converting('/crate/a.mp3', 'aiff'))
    expect(screen.getByTestId('convert-lossy-note')).toHaveTextContent(
      i18n.t('editor.lossyToLossless', { format: 'AIFF' }),
    )
    expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
  })

  it('says the same of a lossless file measured as a lossy source', () => {
    render(converting('/crate/a.flac', 'aiff', cut(16000)))
    expect(screen.getByTestId('convert-lossy-note')).toBeInTheDocument()
  })

  it('stays quiet for a genuine lossless source', () => {
    render(converting('/crate/a.flac', 'aiff', cut(21000)))
    expect(screen.queryByTestId('convert-lossy-note')).toBeNull()
  })

  it('stays quiet when the output is lossy too', () => {
    render(converting('/crate/a.mp3', 'mp3'))
    expect(screen.queryByTestId('convert-lossy-note')).toBeNull()
  })
})

describe('ConvertFooter damaged source note', () => {
  const converting = (spectrum: TrackItem['spectrum']): React.JSX.Element =>
    cloneElement(footer(false), {
      item: {
        id: 't1',
        status: 'idle',
        inputPath: '/crate/a.flac',
        meta: {},
      } as TrackItem,
      spectrum,
      format: 'aiff',
    })
  const measured = (damaged: boolean): TrackItem['spectrum'] =>
    ({
      image: '',
      cutoffHz: 21000,
      sampleRateHz: 44100,
      processed: false,
      damaged,
    }) as TrackItem['spectrum']

  it('warns that a damaged source makes a damaged copy, without blocking the conversion', () => {
    render(converting(measured(true)))
    expect(screen.getByTestId('convert-damaged-note')).toHaveTextContent(
      i18n.t('editor.damagedSource'),
    )
    expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
  })

  it('stays quiet for an intact source', () => {
    render(converting(measured(false)))
    expect(screen.queryByTestId('convert-damaged-note')).toBeNull()
  })
})

describe('ConvertFooter verification', () => {
  beforeEach(() => i18n.changeLanguage('es'))
  afterEach(() => i18n.changeLanguage('en'))

  const fileOk: PlaceCheck = {
    place: 'file',
    state: 'ok',
    detail: { key: 'fileIdentical', params: { format: 'WAV' } },
  }
  const ok = (place: PlaceCheck['place']): PlaceCheck => ({
    place,
    state: 'ok',
    detail: { key: `${place}Ok`, params: { format: 'WAV', cues: 4 } },
  })
  const pending = (place: PlaceCheck['place'], program: string): PlaceCheck => ({
    place,
    state: 'pending',
    detail: { key: 'pending', params: { program } },
  })

  function verified(
    checks: PlaceCheck[],
    opts: { music?: boolean; processing?: boolean } = {},
  ): React.JSX.Element {
    const item = {
      id: 't1',
      status: opts.processing ? 'processing' : 'done',
      stage: opts.processing ? 'verify' : undefined,
      inputPath: '/a.aiff',
      meta: {},
      verification: { status: verificationStatus(checks), checks },
    } as TrackItem
    return cloneElement(footer(!opts.processing), {
      item,
      exportedFormat: opts.processing ? null : 'wav',
      status: { ...status(!opts.processing), inMusicLibraryOnly: !!opts.music },
    })
  }

  // "Done" was said before anything was re-read. Until the checks come back the row says
  // it is still checking, and the success line, the one that promises it worked, waits.
  it('while checking the done row shows verify-checking and no export-success', () => {
    render(
      verified([fileOk, { place: 'rekordbox', state: 'checking', detail: { key: 'checking' } }]),
    )
    expect(within(screen.getByTestId('done-row')).getByTestId('verify-checking')).toHaveTextContent(
      'Comprobando…',
    )
    expect(screen.queryByTestId('export-success')).toBeNull()
    expect(screen.queryByTestId('verify-shield')).toBeNull()
  })

  // The re-read runs inside the job as its last stage: the button must not name a stage
  // it has no words for, and the wording must not change when the result comes back.
  it('stage verify on the processing track shows verify-checking too', () => {
    render(verified([], { processing: true }))
    expect(screen.getByTestId('verify-checking')).toHaveTextContent('Comprobando…')
    expect(screen.queryByTestId('process-btn')).toBeNull()
  })

  it('once ok the success line shows with the verify-shield button', () => {
    render(verified([fileOk]))
    expect(screen.getByTestId('export-success')).toHaveTextContent('✓ Exportado como WAV')
    expect(screen.queryByTestId('verify-checking')).toBeNull()
    // Beside the line it vouches for, not lost among the library icons at the far end.
    expect(screen.getByTestId('export-success').nextElementSibling).toContainElement(
      screen.getByTestId('verify-shield'),
    )
  })

  // A write queued behind an open rekordbox is not done yet: no check mark, and the line
  // says which program it waits on.
  it('a pending rekordbox shows the success text without the check mark and names rekordbox', () => {
    render(verified([fileOk, pending('rekordbox', 'rekordbox')], { music: true }))
    const line = screen.getByTestId('export-success')
    expect(line).toHaveTextContent(/^Añadido a Apple Music · rekordbox al cerrarlo$/)
    expect(line.textContent).not.toContain('✓')
    expect(screen.getByTestId('verify-pending-icon')).toBeInTheDocument()
    expect(screen.getByTestId('verify-shield')).toBeInTheDocument()
  })

  it('two programs pending are joined in the line', () => {
    render(
      verified([fileOk, pending('rekordbox', 'rekordbox'), pending('engine', 'Engine DJ')], {
        music: true,
      }),
    )
    expect(screen.getByTestId('export-success')).toHaveTextContent(
      'Añadido a Apple Music · rekordbox y Engine DJ al cerrarlo',
    )
  })

  it('a pending exported file reads Exportado como WAV · rekordbox al cerrarlo without ✓', () => {
    render(verified([fileOk, pending('rekordbox', 'rekordbox')]))
    const line = screen.getByTestId('export-success')
    expect(line).toHaveTextContent(/^Exportado como WAV · rekordbox al cerrarlo$/)
    expect(line.textContent).not.toContain('✓')
  })

  // The pending line is the longest the row ever holds, and it is the part that tells
  // the DJ to close a program: it wraps at the narrowest editor instead of an ellipsis.
  it('the pending line is never cut short', () => {
    render(verified([fileOk, pending('rekordbox', 'rekordbox'), pending('engine', 'Engine DJ')]))
    expect(screen.getByTestId('export-success').className).not.toMatch(/\btruncate\b/)
  })

  it('the check mark appears only when the queue applied and every place is ok', () => {
    const { rerender } = render(
      verified([fileOk, pending('rekordbox', 'rekordbox')], { music: true }),
    )
    rerender(verified([fileOk, ok('rekordbox')], { music: true }))
    expect(screen.getByTestId('export-success')).toHaveTextContent(/^✓ Añadido a Apple Music$/)
    expect(screen.queryByTestId('verify-pending-icon')).toBeNull()
  })

  it('a pending track never shows the amber line or Reintentar', () => {
    render(verified([fileOk, pending('rekordbox', 'rekordbox')]))
    expect(screen.queryByTestId('verify-mismatch')).toBeNull()
    expect(screen.queryByTestId('verify-retry')).toBeNull()
  })
})
