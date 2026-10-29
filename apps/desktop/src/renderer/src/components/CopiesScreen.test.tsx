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
  render(<CopiesScreen {...props} />)
  return props
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
