import { ChevronDown, ChevronUp, FileAudio } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DjProgram,
  LibraryCopy,
  ProgramCopies,
  RestoreRefusal,
  RestoreResult,
} from '../../../shared/types'
import { COPIES_KEEP, type ProgramState, programState } from '../lib/copiesView'
import { isWindows } from '../lib/platform'
import { ConfirmDialog } from './ConfirmDialog'
import { SOURCE_ICON } from './SourceRail'
import { formatBytes, TrashBrowser, type TrashBrowserProps } from './TrashBrowser'

interface Props {
  programs: ProgramCopies[]
  trash: TrashBrowserProps
  openMusic?: boolean
  onRestore: (program: DjProgram, copyId: string) => Promise<RestoreResult>
  onReveal: () => void
}

type Outcome = { ok: true; takenAt: number } | { ok: false; reason: RestoreRefusal }

const PROGRAM_ORDER: DjProgram[] = ['rekordbox', 'traktor', 'engine']

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

function useWhen(): (ms: number) => string {
  const { i18n } = useTranslation()
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return (ms) => format.format(ms)
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
          </Fact>
          <Fact label={tr('copies.facts.last')} testId={`copies-last-${program}`}>
            {copies.length > 0 ? when(copies[0].takenAt) : tr('copies.none')}
          </Fact>
          {copies.length > 0 && (
            <Fact label={tr('copies.facts.kept')} testId={`copies-kept-${program}`}>
              {tr('copies.kept', { count: copies.length, max: COPIES_KEEP })}
            </Fact>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid={`copies-toggle-${program}`}
          disabled={listed.length === 0}
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
        <button
          type="button"
          data-testid={`copies-restore-${program}`}
          disabled={copies.length === 0 || restoring}
          onClick={() => onAsk(copies[0])}
          className={PRIMARY}
        >
          {tr('copies.restore')}
        </button>
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

function MusicSection({
  trash,
  openMusic,
}: {
  trash: TrashBrowserProps
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
          {entries.length > 0 && (
            <Fact label={tr('copies.facts.kept')} testId="copies-kept-music">
              {tr('trash.summary', {
                count: entries.length,
                size: formatBytes(total, i18n.language),
              })}
            </Fact>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="copies-toggle-music"
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
      </div>
      {open && (
        <div className="col-span-2 col-start-2 flex h-[60vh] max-h-[620px] min-h-[420px] overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)]">
          <TrashBrowser {...trash} total={total} header={<div className="pt-4" />} />
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
