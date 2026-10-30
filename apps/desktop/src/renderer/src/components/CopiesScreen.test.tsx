// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DjProgram,
  LibraryCopy,
  ProgramCopies,
  RestoreResult,
  TrashEntry,
} from '../../../shared/types'
import i18n from '../i18n'
import { installApi } from '../test/api'
import { CopiesScreen } from './CopiesScreen'
import { formatBytes } from './TrashBrowser'

afterEach(cleanup)
beforeEach(() => {
  installApi()
})

const copy = (over: Partial<LibraryCopy> = {}): LibraryCopy => ({
  id: 'c1',
  collectionPath: '/lib/master.db',
  takenAt: new Date(2026, 9, 29, 21, 40).getTime(),
  reason: 'run',
  files: [],
  ...over,
})

const program = (name: DjProgram, over: Partial<ProgramCopies> = {}): ProgramCopies => ({
  program: name,
  collectionPath: `/lib/${name}`,
  copies: [],
  restore: null,
  pending: 0,
  halted: false,
  copyFailed: false,
  untouched: false,
  ...over,
})

const trashEntry: TrashEntry = {
  id: 't1',
  name: 'Around the World.mp3',
  originalPath: '/Music/Around the World.mp3',
  storedPath: '/ud/trash/items/t1-Around the World.mp3',
  bytes: 1024 * 1024,
  trashedAt: Date.now(),
  reason: 'replaced',
}

function when(ms: number): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    ms,
  )
}

function renderScreen(
  programs: ProgramCopies[],
  over: Partial<Parameters<typeof CopiesScreen>[0]> = {},
) {
  const props = {
    programs,
    trash: {
      entries: [trashEntry],
      retentionDays: 7,
      maxBytes: 10 * 1024 * 1024 * 1024,
      onRestore: vi.fn(),
      onRemove: vi.fn(),
      onEmpty: vi.fn(),
      onReveal: vi.fn(),
    },
    onRestore: vi.fn<(p: DjProgram, id: string) => Promise<RestoreResult>>(async () => ({
      ok: true,
    })),
    onReveal: vi.fn(),
    ...over,
  }
  const { rerender } = render(<CopiesScreen {...props} />)
  return {
    ...props,
    rerender: (next: ProgramCopies[]) => rerender(<CopiesScreen {...props} programs={next} />),
  }
}

const latest = copy({ id: 'new' })
const older = copy({ id: 'old', takenAt: new Date(2026, 9, 28, 23, 12).getTime(), reason: 'cues' })

describe('CopiesScreen', () => {
  it("shows each program's state, last copy and how many of five are kept", () => {
    renderScreen([
      program('rekordbox', { copies: [latest, older] }),
      program('traktor', { pending: 3, copies: [latest] }),
      program('engine'),
    ])
    const ids = screen
      .getAllByTestId(/^copies-section-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(ids).toEqual([
      'copies-section-rekordbox',
      'copies-section-traktor',
      'copies-section-engine',
      'copies-section-music',
    ])
    expect(screen.getByTestId('copies-state-rekordbox')).toHaveTextContent(
      i18n.t('copies.state.ok'),
    )
    expect(screen.getByTestId('copies-last-rekordbox')).toHaveTextContent(when(latest.takenAt))
    expect(screen.getByTestId('copies-kept-rekordbox')).toHaveTextContent(
      i18n.t('copies.kept', { count: 2, max: 5 }),
    )
    expect(screen.getByTestId('copies-state-traktor')).toHaveTextContent(
      i18n.t('copies.state.pending', { count: 3, program: i18n.t('sources.traktor') }),
    )
    expect(screen.getByTestId('copies-last-engine')).toHaveTextContent(i18n.t('copies.none'))
    expect(screen.getByTestId('copies-restore-engine')).toBeDisabled()
  })

  it('restoring asks first, says what is lost and that the current state is kept', () => {
    const props = renderScreen([program('rekordbox', { copies: [latest], pending: 3 })])
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    expect(props.onRestore).not.toHaveBeenCalled()
    const name = i18n.t('sources.rekordbox')
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(i18n.t('copies.confirm.body', { program: name }))
    expect(dialog).toHaveTextContent(i18n.t('copies.confirm.safety'))
    expect(dialog).toHaveTextContent(i18n.t('copies.confirm.queue', { count: 3, program: name }))
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(props.onRestore).toHaveBeenCalledWith('rekordbox', 'new')
  })

  it('does not mention waiting changes when there are none', () => {
    renderScreen([program('rekordbox', { copies: [latest] })])
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    const name = i18n.t('sources.rekordbox')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      i18n.t('copies.confirm.queue', { count: 1, program: name }),
    )
  })

  it('a refused restore says why and leaves the screen as it was', async () => {
    renderScreen([program('rekordbox', { copies: [latest] })], {
      onRestore: vi.fn(async () => ({ ok: false, reason: 'running' }) as RestoreResult),
    })
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-ok'))
    })
    expect(screen.getByTestId('copies-refused-rekordbox')).toHaveTextContent(
      i18n.t('copies.refused.running', { program: i18n.t('sources.rekordbox') }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('copies-kept-rekordbox')).toHaveTextContent(
      i18n.t('copies.kept', { count: 1, max: 5 }),
    )
  })

  it('the confirmation names the time the library goes back to', () => {
    renderScreen([program('rekordbox', { copies: [latest, older] })])
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      i18n.t('copies.confirm.title', {
        program: i18n.t('sources.rekordbox'),
        when: when(latest.takenAt),
      }),
    )
  })

  it('the confirmation counts the waiting changes there are when it is read, not when it opened', () => {
    const view = renderScreen([program('rekordbox', { copies: [latest], pending: 1 })])
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    view.rerender([program('rekordbox', { copies: [latest], pending: 4 })])
    const name = i18n.t('sources.rekordbox')
    expect(screen.getByRole('dialog')).toHaveTextContent(
      i18n.t('copies.confirm.queue', { count: 4, program: name }),
    )
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(view.onRestore).toHaveBeenCalledWith('rekordbox', 'new')
  })

  it('closes the confirmation when the copy it would restore is gone', () => {
    const view = renderScreen([program('rekordbox', { copies: [latest] })])
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    view.rerender([program('rekordbox', { copies: [older] })])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender([program('rekordbox', { copies: [latest, older] })])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a restore that throws says the library did not change', async () => {
    renderScreen([program('rekordbox', { copies: [latest] })], {
      onRestore: vi.fn(async (): Promise<RestoreResult> => {
        throw new Error('ipc gone')
      }),
    })
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-ok'))
    })
    expect(screen.getByTestId('copies-refused-rekordbox')).toHaveTextContent(
      i18n.t('copies.refused.failed'),
    )
  })

  it('a restore that worked says to when, until the next attempt', async () => {
    const onRestore = vi
      .fn<(p: DjProgram, id: string) => Promise<RestoreResult>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'running' })
    renderScreen([program('rekordbox', { copies: [latest, older] })], { onRestore })
    fireEvent.click(screen.getByTestId('copies-toggle-rekordbox'))
    fireEvent.click(screen.getByTestId('copies-restore-item-old'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-ok'))
    })
    expect(screen.getByTestId('copies-restored-rekordbox')).toHaveTextContent(
      i18n.t('copies.restored', {
        program: i18n.t('sources.rekordbox'),
        when: when(older.takenAt),
      }),
    )
    fireEvent.click(screen.getByTestId('copies-restore-rekordbox'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-ok'))
    })
    expect(screen.queryByTestId('copies-restored-rekordbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('copies-refused-rekordbox')).toBeInTheDocument()
  })

  it('restore stays available for a program set to "No tocar"', () => {
    renderScreen([program('engine', { untouched: true, copies: [latest] })])
    expect(screen.getByTestId('copies-state-engine')).toHaveTextContent(
      i18n.t('copies.state.untouched'),
    )
    expect(screen.getByTestId('copies-restore-engine')).toBeEnabled()
  })

  it('lists the copy taken before restoring first and restores any copy from the list', () => {
    const before = copy({ id: 'pre', reason: 'restore', takenAt: Date.now() })
    const props = renderScreen([program('rekordbox', { copies: [latest, older], restore: before })])
    expect(screen.queryByTestId('copies-item-old')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('copies-toggle-rekordbox'))
    const items = within(screen.getByTestId('copies-section-rekordbox')).getAllByTestId(
      /^copies-item-/,
    )
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual([
      'copies-item-pre',
      'copies-item-new',
      'copies-item-old',
    ])
    expect(items[0]).toHaveTextContent(i18n.t('copies.reason.restore'))
    expect(items[2]).toHaveTextContent(i18n.t('copies.reason.cues'))
    fireEvent.click(screen.getByTestId('copies-restore-item-old'))
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(props.onRestore).toHaveBeenCalledWith('rekordbox', 'old')
  })

  it('shows how many music originals are kept and how much they weigh', () => {
    renderScreen([])
    expect(screen.getByTestId('copies-section-music')).toHaveTextContent(
      i18n.t('trash.summary', { count: 1, size: '1 MB' }),
    )
    expect(screen.queryByTestId('trash-search')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('copies-toggle-music'))
    expect(screen.getByTestId('trash-search')).toBeInTheDocument()
  })

  it("opening from a track's backup mark lands on the music files with the search filled", () => {
    const base = {
      entries: [trashEntry],
      retentionDays: 7,
      maxBytes: 1024,
      onRestore: vi.fn(),
      onRemove: vi.fn(),
      onEmpty: vi.fn(),
      onReveal: vi.fn(),
    }
    renderScreen([program('rekordbox')], {
      openMusic: true,
      trash: { ...base, initialQuery: 'Around the World' },
    })
    expect(screen.getByTestId('trash-search')).toHaveValue('Around the World')
  })

  it('shows the folder with every copy', () => {
    const props = renderScreen([])
    fireEvent.click(screen.getByTestId('copies-reveal'))
    expect(props.onReveal).toHaveBeenCalled()
    expect(screen.getByTestId('copies-screen')).toHaveTextContent(
      i18n.t('copies.footer', { days: 7 }),
    )
  })
})

const DAY = 24 * 60 * 60 * 1000

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 'e1',
  name: 'Track.aiff',
  originalPath: '/Music/Crate/Track.aiff',
  storedPath: '/ud/trash/items/e1-Track.aiff',
  bytes: 60 * 1024 * 1024,
  trashedAt: Date.now(),
  reason: 'replaced',
  ...over,
})

function renderMusic(entries: TrashEntry[]) {
  const trash = {
    entries,
    retentionDays: 30,
    maxBytes: 10 * 1024 * 1024 * 1024,
    onRestore: vi.fn(),
    onRemove: vi.fn(),
    onEmpty: vi.fn(),
    onReveal: vi.fn(),
  }
  renderScreen([], { trash, openMusic: true })
  return trash
}

describe('CopiesScreen music files', () => {
  // The music section exists for one moment: a conversion went wrong and the user wants the
  // file back. The row has to name the file, where it lived and why it is here, and put
  // the way back one click away.
  it('lists each original with its folder and reason, and restores on click', () => {
    const props = renderMusic([entry(), entry({ id: 'e2', name: 'Other.wav', reason: 'renamed' })])
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Track.aiff')
    expect(rows[0]).toHaveTextContent('/Music/Crate')
    expect(screen.getByTestId('copies-kept-music')).toHaveTextContent('2')
    fireEvent.click(screen.getAllByTestId('trash-restore')[1])
    expect(props.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'e2' }))
  })

  // "Replaced by a conversion" without naming the file that took its place sends the user
  // to the folder to work out what happened. outputPath is already on the entry.
  it('names the file that took the original place', () => {
    renderMusic([entry({ outputPath: '/Music/Crate/Track.flac' })])
    expect(screen.getByTestId('trash-row')).toHaveTextContent('Track.flac')
  })

  // "Track (Original Mix)" and "Track (Extended Mix)" cut at the same width look alike, and
  // restoring the wrong one is the mistake this panel exists to undo. Hovering shows it all.
  it('shows the full name and folder of a cut row on hover', () => {
    renderMusic([entry({ name: 'Track (Extended Mix).aiff' })])
    expect(screen.getByTitle('Track (Extended Mix).aiff')).toBeInTheDocument()
    expect(screen.getByTitle('/Music/Crate')).toBeInTheDocument()
  })

  it('falls back to the bare reason when nothing replaced the original', () => {
    renderMusic([entry({ reason: 'deleted' })])
    const row = screen.getByTestId('trash-row')
    expect(row).toHaveTextContent(/deleted from Surco/i)
  })

  // The sidebar navigates by reason, which is the only axis this list has. Its counts read
  // the whole trash, so they keep answering "what is in here" while a search narrows the rows.
  it('filters by reason from the sidebar without changing the counts', () => {
    renderMusic([
      entry({ id: 'a', reason: 'replaced' }),
      entry({ id: 'b', name: 'Renamed.mp3', reason: 'renamed' }),
    ])
    expect(screen.getByTestId('trash-filter-replaced')).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId('trash-filter-renamed'))
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Renamed.mp3')
    expect(screen.getByTestId('trash-filter-replaced')).toHaveTextContent('1')
  })

  // A replaced crate is looked up by the crate, not by each file's name.
  it('searches the name and the folder', () => {
    renderMusic([
      entry({ id: 'a', name: 'Pray.aiff', originalPath: '/Music/House/Pray.aiff' }),
      entry({ id: 'b', name: 'Jaguar.wav', originalPath: '/Music/Detroit/Jaguar.wav' }),
    ])
    fireEvent.change(screen.getByTestId('trash-search'), { target: { value: 'detroit' } })
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Jaguar.wav')
  })

  // A search that matches nothing is not an empty trash: saying "nothing to restore" there
  // would tell the user their files are gone.
  it('tells a fruitless search apart from an empty trash', () => {
    renderMusic([entry()])
    fireEvent.change(screen.getByTestId('trash-search'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('trash-no-matches')).toBeInTheDocument()
    expect(screen.queryByTestId('trash-empty')).not.toBeInTheDocument()
  })

  // The trash deletes files by itself, which no OS trash does by default. The warning is
  // drawn only in the last week, where it means something — on every row it would be noise.
  it('warns only on the entries the sweep is about to take', () => {
    renderMusic([
      entry({ id: 'fresh', trashedAt: Date.now() }),
      entry({ id: 'soon', name: 'Soon.aiff', trashedAt: Date.now() - 28 * DAY }),
    ])
    const badges = screen.getAllByTestId('trash-expiring')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('2')
  })

  // The badge only appears on some rows, so it has to occupy a reserved lane rather than
  // push the buttons left: without one, Restore sits at a different x on every row that
  // is about to expire, and a long list has a column that wobbles as you scan it.
  it('keeps the actions in a fixed column whether or not a row warns', () => {
    renderMusic([
      entry({ id: 'fresh', trashedAt: Date.now() }),
      entry({ id: 'soon', trashedAt: Date.now() - 28 * DAY }),
    ])
    const lanes = screen.getAllByTestId('trash-expiring-lane')
    expect(lanes).toHaveLength(2)
    expect(lanes[0]).toBeEmptyDOMElement()
    expect(lanes[1]).not.toBeEmptyDOMElement()
  })

  it('shows how much room the trash takes when it is empty', () => {
    renderMusic([])
    expect(screen.getByTestId('trash-empty')).toBeInTheDocument()
    expect(screen.getByTestId('trash-usage')).toHaveTextContent('10 GB')
  })

  // Settings' rule: a control that is not available stays visible and disabled, so the
  // footer never changes shape between an empty and a full trash.
  it('keeps emptying visible but disabled when there is nothing to empty', () => {
    renderMusic([])
    expect(screen.getByTestId('trash-empty-button')).toBeDisabled()
  })

  // Emptying is the one irreversible action here, so it asks once, in place, and only
  // the second press fires.
  it('empties only after an inline confirmation', () => {
    const props = renderMusic([entry()])
    fireEvent.click(screen.getByTestId('trash-empty-button'))
    expect(props.onEmpty).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('trash-empty-confirm'))
    expect(props.onEmpty).toHaveBeenCalledTimes(1)
  })

  // The confirm appears where Delete all was, so a double-click armed it and fired it in
  // one gesture: every backup gone for good. The second click of a double-click is not
  // a confirmation.
  it('does not empty on the second click of a double-click', () => {
    const props = renderMusic([entry()])
    fireEvent.click(screen.getByTestId('trash-empty-button'), { detail: 1 })
    fireEvent.click(screen.getByTestId('trash-empty-confirm'), { detail: 2 })
    expect(props.onEmpty).not.toHaveBeenCalled()
    expect(screen.getByTestId('trash-empty-confirm')).toBeInTheDocument()
  })

  // Deleting one backup is as irreversible as emptying them all, and the X sits right
  // beside Restore, so a stray click must not destroy the only copy of an original.
  it('removes one entry only after an inline confirmation on that row', () => {
    const props = renderMusic([entry(), entry({ id: 'e2', name: 'Other.aiff' })])
    fireEvent.click(screen.getAllByTestId('trash-remove')[0])
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('trash-remove-confirm')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('trash-remove-confirm'))
    expect(props.onRemove).toHaveBeenCalledTimes(1)
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
  })

  // The confirm takes the X's place, so a double-click on the X must not fire it.
  it('does not remove an entry on the second click of a double-click', () => {
    const props = renderMusic([entry()])
    fireEvent.click(screen.getByTestId('trash-remove'), { detail: 1 })
    fireEvent.click(screen.getByTestId('trash-remove-confirm'), { detail: 2 })
    expect(props.onRemove).not.toHaveBeenCalled()
  })

  it('reveals the folder', () => {
    const props = renderMusic([entry()])
    fireEvent.click(screen.getByTestId('trash-reveal'))
    expect(props.onReveal).toHaveBeenCalledTimes(1)
  })
})

describe('formatBytes', () => {
  it('picks the unit a DJ reads sizes in', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(60 * 1024 * 1024, 'en')).toBe('60 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, 'en')).toBe('1.5 GB')
  })
})
