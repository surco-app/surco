import { ChevronDown, ChevronUp, FileAudio, RotateCcw, Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DjProgram,
  LibraryCopy,
  ProgramCopies,
  RestoreRefusal,
  RestoreResult,
  TrashEntry,
} from '../../../shared/types'
import { baseName } from '../lib/baseName'
import { COPIES_KEEP, type ProgramState, programState } from '../lib/copiesView'
import { useOpenSettings } from '../lib/openSettingsContext'
import { isWindows } from '../lib/platform'
import {
  countByReason,
  daysLeft,
  EXPIRING_SOON_DAYS,
  TRASH_FILTERS,
  type TrashFilter,
  visibleEntries,
} from '../lib/trashView'
import { ConfirmDialog } from './ConfirmDialog'
import { SOURCE_ICON } from './SourceRail'

export interface MusicFilesProps {
  entries: TrashEntry[]
  retentionDays: number
  maxBytes: number
  onRestore: (entry: TrashEntry) => void
  onRemove: (entry: TrashEntry) => void
  onEmpty: () => void
  onReveal: () => void
  // Opened from one track's backup mark: the search starts on that file's name, so the
  // section lands on its copies and clearing the box brings the whole list back.
  initialQuery?: string
}

interface Props {
  programs: ProgramCopies[]
  trash: MusicFilesProps
  openMusic?: boolean
  onRestore: (program: DjProgram, copyId: string) => Promise<RestoreResult>
  onReveal: () => void
}

type Outcome = { ok: true; takenAt: number } | { ok: false; reason: RestoreRefusal }

const PROGRAM_ORDER: DjProgram[] = ['rekordbox', 'traktor', 'engine']

const MUSIC_TOOLS_MIN = 9

const STATE_TONE: Record<ProgramState, string> = {
  ok: 'text-[var(--color-good)]',
  pending: 'text-[var(--color-warn)]',
  halted: 'text-[var(--color-danger)]',
  failed: 'text-[var(--color-danger)]',
  untouched: 'text-fg-faint',
}

const BUTTON =
  'press flex items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-[12.5px] text-fg hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:hover:bg-transparent'
const PRIMARY =
  'press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:hover:bg-[var(--color-accent)]'
const SECTION =
  'grid grid-cols-[44px_1fr_auto] items-center gap-x-3.5 gap-y-2 border-t border-[var(--color-line)] py-4.5 first:border-t-0'
const BADGE =
  'flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--color-hover)] text-fg-muted'
const FACTS = 'mt-1.5 grid grid-cols-[13rem_11rem_minmax(0,1fr)] gap-x-5.5'
const LIST =
  'col-span-2 col-start-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-1'

export function formatBytes(bytes: number, lng: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const digits = i >= 2 ? 1 : 0
  return `${value.toLocaleString(lng, { maximumFractionDigits: digits })} ${units[i]}`
}

function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

function daysBefore(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() - days)
  return day.toDateString()
}

function useWhen(): (ms: number) => string {
  const { t: tr, i18n } = useTranslation()
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const clock = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' })
  return (ms) => {
    const day = new Date(ms).toDateString()
    if (day === daysBefore(0)) return tr('copies.today', { time: clock.format(ms) })
    if (day === daysBefore(1)) return tr('copies.yesterday', { time: clock.format(ms) })
    return format.format(ms)
  }
}

function Fact({
  label,
  testId,
  className = 'text-fg',
  children,
}: {
  label: string
  testId: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] tracking-wide text-fg-faint uppercase">{label}</div>
      <div data-testid={testId} className={`text-[13px] ${className}`}>
        {children}
      </div>
    </div>
  )
}

function ProgramSection({
  entry,
  outcome,
  restoring,
  onAsk,
}: {
  entry: ProgramCopies
  outcome?: Outcome
  restoring: boolean
  onAsk: (copy: LibraryCopy) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const when = useWhen()
  const openSettings = useOpenSettings()
  const [open, setOpen] = useState(false)
  const { program, copies } = entry
  const name = tr(`sources.${program}`)
  const state = programState(entry)
  const Icon = SOURCE_ICON[program]
  const listed = entry.restore ? [entry.restore, ...copies] : copies

  return (
    <section data-testid={`copies-section-${program}`} className={SECTION}>
      <div className={BADGE}>
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold text-fg">{name}</h2>
        <div className={FACTS}>
          <Fact
            label={tr('copies.facts.state')}
            testId={`copies-state-${program}`}
            className={STATE_TONE[state]}
          >
            {tr(`copies.state.${state}`, { count: entry.pending, program: name })}
            {state === 'untouched' && (
              <button
                type="button"
                data-testid={`copies-settings-${program}`}
                onClick={() => openSettings('destination')}
                className="press ml-2 text-[12.5px] text-[var(--color-accent)] hover:underline"
              >
                {tr('copies.changeInSettings')}
              </button>
            )}
          </Fact>
          <Fact label={tr('copies.facts.last')} testId={`copies-last-${program}`}>
            {copies.length > 0 ? when(copies[0].takenAt) : tr('copies.none')}
          </Fact>
          <Fact label={tr('copies.facts.kept')} testId={`copies-kept-${program}`}>
            {tr('copies.kept', { count: copies.length, max: COPIES_KEEP })}
          </Fact>
        </div>
      </div>
      <div className="flex gap-2">
        {listed.length > 0 && (
          <button
            type="button"
            data-testid={`copies-toggle-${program}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={BUTTON}
          >
            {tr(open ? 'copies.hide' : 'copies.show')}
            {open ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
        {copies.length > 0 && (
          <button
            type="button"
            data-testid={`copies-restore-${program}`}
            disabled={restoring}
            onClick={() => onAsk(copies[0])}
            className={PRIMARY}
          >
            {tr('copies.restore')}
          </button>
        )}
      </div>
      {outcome?.ok === false && (
        <p
          role="status"
          data-testid={`copies-refused-${program}`}
          className="col-span-2 col-start-2 text-[13px] text-[var(--color-danger)]"
        >
          {tr(`copies.refused.${outcome.reason}`, { program: name })}
        </p>
      )}
      {outcome?.ok && (
        <p
          role="status"
          data-testid={`copies-restored-${program}`}
          className="col-span-2 col-start-2 text-[13px] text-[var(--color-good)]"
        >
          {tr('copies.restored', { program: name, when: when(outcome.takenAt) })}
        </p>
      )}
      {open && listed.length > 0 && (
        <ul className={LIST}>
          {listed.map((c) => (
            <li
              key={c.id}
              data-testid={`copies-item-${c.id}`}
              className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0"
            >
              <div>
                <div className="text-[13px] text-fg">{when(c.takenAt)}</div>
                <div className="text-[12.5px] text-fg-faint">{tr(`copies.reason.${c.reason}`)}</div>
              </div>
              <button
                type="button"
                data-testid={`copies-restore-item-${c.id}`}
                disabled={restoring}
                onClick={() => onAsk(c)}
                className={BUTTON}
              >
                {tr('copies.restoreThis')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MusicFiles({
  entries,
  retentionDays,
  onRestore,
  onRemove,
  onEmpty,
  onReveal,
  initialQuery = '',
}: MusicFilesProps): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lng = i18n.language
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [filter, setFilter] = useState<TrashFilter>('all')
  const [query, setQuery] = useState(initialQuery)
  const counts = countByReason(entries)
  const tools = entries.length >= MUSIC_TOOLS_MIN || initialQuery !== ''
  const active = counts[filter] > 0 ? filter : 'all'
  const rows = tools ? visibleEntries(entries, active, query) : entries
  const confirming = confirmEmpty || confirmRemove !== null

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setConfirmEmpty(false)
      setConfirmRemove(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirming])

  return (
    <div className="flex flex-col gap-2">
      {tools && (
        <div className="flex flex-wrap items-center gap-2">
          {TRASH_FILTERS.filter((id) => id === 'all' || counts[id] > 0).map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`trash-filter-${id}`}
              aria-pressed={active === id}
              onClick={() => setFilter(id)}
              className={`press rounded-full border px-2.5 py-0.5 text-[12px] ${
                active === id
                  ? 'border-transparent bg-[var(--color-accent-soft)] text-fg'
                  : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
              }`}
            >
              {tr(`trash.filters.${id}`)}{' '}
              <span className="text-fg-faint tabular-nums">{counts[id]}</span>
            </button>
          ))}
          <div className="ml-auto flex w-60 items-center gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-field)] px-2.5 py-1.5 focus-within:border-[var(--color-accent)]">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
            <input
              data-testid="trash-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={tr('trash.search')}
              placeholder={tr('trash.search')}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>
      )}
      <div className={LIST}>
        {rows.length === 0 ? (
          <p data-testid="trash-no-matches" className="py-2.5 text-[12.5px] text-fg-faint">
            {tr('trash.noMatches')}
          </p>
        ) : (
          <ul data-testid="trash-list">
            {rows.map((entry) => {
              const left = daysLeft(entry, retentionDays)
              const replacement = entry.outputPath ? baseName(entry.outputPath) : null
              return (
                <li
                  key={entry.id}
                  data-testid="trash-row"
                  className="flex items-center gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span title={entry.name} className="truncate text-[13px] text-fg">
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-[12.5px] text-fg-faint tabular-nums">
                        · {formatBytes(entry.bytes, lng)}
                      </span>
                    </div>
                    {/* What happened, and to what. The entry has carried the replacement's
                      path all along; without it the row makes the user open the folder
                      to find out which file took the original's place. */}
                    <div
                      data-testid="trash-reason"
                      className="truncate text-[12.5px] text-fg-faint first-letter:uppercase"
                    >
                      {replacement ? (
                        <>
                          {tr(entry.reason === 'renamed' ? 'trash.renamedTo' : 'trash.replacedBy')}{' '}
                          <span className="text-fg-muted">{replacement}</span>
                        </>
                      ) : (
                        tr(`trash.reason.${entry.reason}`)
                      )}
                    </div>
                    <div
                      title={folderOf(entry.originalPath)}
                      className="truncate text-[11.5px] text-fg-faint"
                    >
                      {folderOf(entry.originalPath)}
                    </div>
                  </div>
                  {/* A lane of its own, held open on every row: the badge only shows on
                    the few about to be swept, and letting it push the buttons would
                    put Restore at a different x on each of them. */}
                  <div
                    data-testid="trash-expiring-lane"
                    className="flex w-[92px] shrink-0 justify-end"
                  >
                    {left <= EXPIRING_SOON_DAYS && (
                      <span
                        data-testid="trash-expiring"
                        className="whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--color-warn)_12%,transparent)] px-2 py-0.5 text-[11.5px] text-[var(--color-warn)]"
                      >
                        {tr('trash.expiring', { count: left })}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(entry)}
                    data-testid="trash-restore"
                    className={BUTTON}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {tr('trash.restore')}
                  </button>
                  {confirmRemove === entry.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        // Same guard as Delete all: the confirm takes the X's place.
                        if (e.detail > 1) return
                        setConfirmRemove(null)
                        onRemove(entry)
                      }}
                      data-testid="trash-remove-confirm"
                      className="press shrink-0 whitespace-nowrap rounded-lg bg-[var(--color-danger)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--color-on-accent)]"
                    >
                      {tr('trash.removeConfirm')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(entry.id)}
                      data-testid="trash-remove"
                      aria-label={tr('trash.remove')}
                      title={tr('trash.remove')}
                      className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-faint hover:bg-[var(--color-hover)] hover:text-[var(--color-danger)]"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div
          data-testid="trash-footer"
          className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] pt-2.5 pb-1.5"
        >
          <span className="text-[12.5px] text-fg-faint">
            {tr('copies.music.expires', { days: retentionDays })}
          </span>
          <span className="flex items-center gap-4.5">
            <button
              type="button"
              onClick={onReveal}
              data-testid="trash-reveal"
              className="press text-[12.5px] text-[var(--color-accent)] hover:underline"
            >
              {tr('trash.reveal')}
            </button>
            {confirmEmpty ? (
              <button
                type="button"
                onClick={(e) => {
                  // The confirm takes the armed button's place, so a double-click's second
                  // click lands on it; only a fresh click confirms.
                  if (e.detail > 1) return
                  setConfirmEmpty(false)
                  onEmpty()
                }}
                data-testid="trash-empty-confirm"
                className="press whitespace-nowrap rounded-lg bg-[var(--color-danger)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--color-on-accent)]"
              >
                {tr('trash.emptyConfirm', { count: entries.length })}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmEmpty(true)}
                data-testid="trash-empty-button"
                className="press text-[12.5px] text-[var(--color-danger)] hover:underline"
              >
                {tr('trash.empty')}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

function MusicSection({
  trash,
  openMusic,
}: {
  trash: MusicFilesProps
  openMusic: boolean
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const when = useWhen()
  const [open, setOpen] = useState(openMusic)
  const ref = useRef<HTMLElement>(null)
  const { entries } = trash
  const total = entries.reduce((sum, e) => sum + e.bytes, 0)
  const last = entries.reduce((max, e) => Math.max(max, e.trashedAt), 0)

  useEffect(() => {
    if (openMusic) ref.current?.scrollIntoView?.({ block: 'start' })
  }, [openMusic])

  return (
    <section ref={ref} data-testid="copies-section-music" className={SECTION}>
      <div className={BADGE}>
        <FileAudio className="h-5.5 w-5.5" strokeWidth={1.6} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold text-fg">{tr('copies.music.title')}</h2>
        <div className={FACTS}>
          <Fact
            label={tr('copies.facts.state')}
            testId="copies-state-music"
            className="text-[var(--color-good)]"
          >
            {tr('copies.music.state')}
          </Fact>
          <Fact label={tr('copies.facts.last')} testId="copies-last-music">
            {entries.length > 0 ? when(last) : tr('copies.none')}
          </Fact>
          <Fact label={tr('copies.music.kept')} testId="copies-kept-music">
            {tr('copies.music.summary', {
              count: entries.length,
              size: formatBytes(total, i18n.language),
              max: formatBytes(trash.maxBytes, i18n.language),
            })}
          </Fact>
        </div>
      </div>
      <div className="flex gap-2">
        {entries.length > 0 && (
          <button
            type="button"
            data-testid="copies-toggle-music"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={BUTTON}
          >
            {tr(open ? 'copies.music.hide' : 'copies.music.show')}
            {open ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {open && entries.length > 0 && (
        <div className="col-span-2 col-start-2">
          <MusicFiles {...trash} />
        </div>
      )}
    </section>
  )
}

export function CopiesScreen({
  programs,
  trash,
  openMusic = false,
  onRestore,
  onReveal,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const when = useWhen()
  const [asking, setAsking] = useState<{ program: DjProgram; copyId: string } | null>(null)
  const [outcomes, setOutcomes] = useState<Partial<Record<DjProgram, Outcome>>>({})
  const [restoring, setRestoring] = useState(0)
  const sorted = PROGRAM_ORDER.flatMap((p) => programs.filter((e) => e.program === p))
  const askedEntry = asking && programs.find((e) => e.program === asking.program)
  const askedCopy =
    askedEntry && [askedEntry.restore, ...askedEntry.copies].find((c) => c?.id === asking?.copyId)

  useEffect(() => {
    if (asking && !askedCopy) setAsking(null)
  }, [asking, askedCopy])

  useEffect(() => {
    if (!asking && restoring === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setAsking(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [asking, restoring])

  const settle = (program: DjProgram, outcome: Outcome | undefined): void =>
    setOutcomes((o) => ({ ...o, [program]: outcome }))

  const restore = async (program: DjProgram, copy: LibraryCopy): Promise<void> => {
    settle(program, undefined)
    setRestoring((n) => n + 1)
    try {
      const result = await onRestore(program, copy.id)
      settle(program, result.ok ? { ok: true, takenAt: copy.takenAt } : result)
    } catch {
      settle(program, { ok: false, reason: 'failed' })
    } finally {
      setRestoring((n) => n - 1)
    }
  }

  const confirmText = (entry: ProgramCopies): string => {
    const name = tr(`sources.${entry.program}`)
    return [
      tr('copies.confirm.body', { program: name }),
      entry.pending > 0 ? tr('copies.confirm.queue', { count: entry.pending, program: name }) : '',
      tr('copies.confirm.safety'),
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div
      data-testid="copies-screen"
      className="h-full overflow-y-auto bg-[var(--color-panel)] px-6.5 py-5.5"
    >
      <div className="max-w-[920px]">
        <header>
          <h1 className="text-[17px] font-semibold text-fg">{tr('copies.title')}</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-faint">{tr('copies.intro')}</p>
        </header>
        <div className="mt-2.5">
          {sorted.map((entry) => (
            <ProgramSection
              key={entry.program}
              entry={entry}
              outcome={outcomes[entry.program]}
              restoring={restoring > 0}
              onAsk={(copy) => setAsking({ program: entry.program, copyId: copy.id })}
            />
          ))}
          <MusicSection trash={trash} openMusic={openMusic} />
        </div>
        <footer className="mt-1.5 flex items-center justify-between gap-4 border-t border-[var(--color-line)] pt-3.5">
          <span className="text-[12.5px] text-fg-faint">
            {tr('copies.footer', { days: trash.retentionDays })}
          </span>
          <button
            type="button"
            data-testid="copies-reveal"
            onClick={onReveal}
            className="press text-[12.5px] text-[var(--color-accent)] hover:underline"
          >
            {tr(isWindows() ? 'copies.revealWin' : 'copies.reveal')}
          </button>
        </footer>
      </div>
      {askedEntry && askedCopy && (
        <ConfirmDialog
          title={tr('copies.confirm.title', {
            program: tr(`sources.${askedEntry.program}`),
            when: when(askedCopy.takenAt),
          })}
          message={confirmText(askedEntry)}
          confirmLabel={tr('copies.confirm.ok')}
          onConfirm={() => void restore(askedEntry.program, askedCopy)}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  )
}
