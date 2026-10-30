import { Archive, FolderOpen, Pencil, RotateCcw, Search, Undo2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrashEntry } from '../../../shared/types'
import { baseName } from '../lib/baseName'
import {
  countByReason,
  daysLeft,
  EXPIRING_SOON_DAYS,
  TRASH_FILTERS,
  type TrashFilter,
  visibleEntries,
} from '../lib/trashView'
import { SECTION_SUBHEAD } from './SectionSubhead'

export interface TrashBrowserProps {
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
  header?: React.ReactNode
}

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

const FILTER_ICONS: Record<TrashFilter, typeof Archive> = {
  all: Archive,
  replaced: RotateCcw,
  renamed: Pencil,
  deleted: X,
  'restored-over': Undo2,
}

export function TrashBrowser({
  entries,
  retentionDays,
  maxBytes,
  onRestore,
  onRemove,
  onEmpty,
  onReveal,
  initialQuery = '',
  header,
}: TrashBrowserProps): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lng = i18n.language
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [filter, setFilter] = useState<TrashFilter>('all')
  const [query, setQuery] = useState(initialQuery)
  const total = entries.reduce((sum, e) => sum + e.bytes, 0)
  const counts = countByReason(entries)
  const rows = visibleEntries(entries, filter, query)
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
    <>
      <div className="flex w-[188px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-panel-2)] p-3">
        <p className={`${SECTION_SUBHEAD} mb-1 px-3`}>{tr('trash.filtersLabel')}</p>
        {TRASH_FILTERS.map((id) => {
          const Icon = FILTER_ICONS[id]
          const active = filter === id
          return (
            <button
              key={id}
              type="button"
              data-testid={`trash-filter-${id}`}
              onClick={() => setFilter(id)}
              // A reason with nothing in it stays visible and disabled rather than
              // vanishing, so the sidebar never changes shape as the trash fills.
              disabled={counts[id] === 0}
              className={`press flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200 disabled:opacity-50 ${
                active
                  ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                  : 'text-fg-muted enabled:hover:bg-[var(--color-panel)] enabled:hover:text-fg'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              {tr(`trash.filters.${id}`)}
              <span className="ml-auto text-xs text-fg-faint tabular-nums">{counts[id]}</span>
            </button>
          )
        })}

        <div className="mt-auto border-t border-[var(--color-line)] px-3 pt-3">
          <p className="text-[11px] text-fg-faint" data-testid="trash-usage">
            {tr('trash.usage', { used: formatBytes(total, lng), size: formatBytes(maxBytes, lng) })}
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-scrollbar)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${Math.min(100, (total / maxBytes) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-pretty text-[11px] leading-relaxed text-fg-faint">
            {tr('trash.selfEmpties', { days: retentionDays })}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {header}

        {entries.length > 0 && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1.5 focus-within:border-[var(--color-accent)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
              <input
                data-testid="trash-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={tr('trash.search')}
                placeholder={tr('trash.search')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {entries.length === 0 ? (
            <div
              className="flex h-full flex-col items-center justify-center px-10 text-center"
              data-testid="trash-empty"
            >
              <div className="flex h-13 w-13 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-field)] p-3.5">
                <Archive className="h-5 w-5 text-fg-faint" strokeWidth={1.6} aria-hidden="true" />
              </div>
              <p className="mt-4 text-sm font-medium text-fg">{tr('trash.emptyTitle')}</p>
              <p className="mt-1.5 max-w-[380px] text-xs leading-relaxed text-fg-dim">
                {tr('trash.emptyBody')}
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div
              className="flex h-full items-center justify-center text-sm text-fg-dim"
              data-testid="trash-no-matches"
            >
              {tr('trash.noMatches')}
            </div>
          ) : (
            <ul
              className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-field)]"
              data-testid="trash-list"
            >
              {rows.map((entry) => {
                const left = daysLeft(entry, retentionDays)
                const replacement = entry.outputPath ? baseName(entry.outputPath) : null
                return (
                  <li
                    key={entry.id}
                    data-testid="trash-row"
                    className="flex items-center gap-3 border-b border-[var(--color-line)] px-3.5 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          title={entry.name}
                          className="truncate text-[13px] font-medium text-fg"
                        >
                          {entry.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-faint tabular-nums">
                          {formatBytes(entry.bytes, lng)}
                        </span>
                      </div>
                      {/* What happened, and to what. The entry has carried the replacement's
                        path all along; without it the row makes the user open the folder
                        to find out which file took the original's place. */}
                      <div className="truncate text-[11px] text-fg-dim">
                        {replacement ? (
                          <>
                            {tr(
                              entry.reason === 'renamed' ? 'trash.renamedTo' : 'trash.replacedBy',
                            )}{' '}
                            <span className="text-fg-muted">{replacement}</span>
                          </>
                        ) : (
                          tr(`trash.reason.${entry.reason}`)
                        )}
                      </div>
                      <div
                        title={folderOf(entry.originalPath)}
                        className="truncate font-mono text-[11px] text-fg-faint"
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
                          className="rounded-full bg-[color-mix(in_srgb,var(--color-warn)_14%,transparent)] px-2 py-0.5 text-[11px] text-warn"
                        >
                          {tr('trash.expiring', { count: left })}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestore(entry)}
                      data-testid="trash-restore"
                      className="press flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-xs text-fg hover:border-[var(--color-accent)]"
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
                        className="press shrink-0 rounded-lg bg-danger px-2.5 py-1.5 text-xs font-medium text-[var(--color-on-accent)]"
                      >
                        {tr('trash.removeConfirm')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(entry.id)}
                        data-testid="trash-remove"
                        aria-label={tr('trash.remove')}
                        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-faint hover:bg-[var(--color-hover)] hover:text-danger"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-line)] px-5 py-3">
          <button
            type="button"
            onClick={onReveal}
            data-testid="trash-reveal"
            className="press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
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
              className="press ml-auto rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)]"
            >
              {tr('trash.emptyConfirm', { count: entries.length })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEmpty(true)}
              data-testid="trash-empty-button"
              disabled={entries.length === 0}
              className="press ml-auto rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs text-fg-muted enabled:hover:border-danger enabled:hover:text-danger disabled:opacity-50"
            >
              {tr('trash.empty')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
