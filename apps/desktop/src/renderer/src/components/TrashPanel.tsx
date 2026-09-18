import { FolderOpen, RotateCcw, Trash2, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrashEntry } from '../../../shared/types'
import { ModalShell } from './ModalShell'

interface Props {
  entries: TrashEntry[]
  retentionDays: number
  maxBytes: number
  onRestore: (entry: TrashEntry) => void
  onRemove: (entry: TrashEntry) => void
  onEmpty: () => void
  onReveal: () => void
  onClose: () => void
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

// Surco's own trash, as a card dialog like the other list-wide surfaces: every original a
// conversion replaced or renamed away, newest first, with the two things a user needs when
// a write went wrong — put it back, or let it go. Emptying asks once, inline, rather than
// through a second dialog.
export function TrashPanel({
  entries,
  retentionDays,
  maxBytes,
  onRestore,
  onRemove,
  onEmpty,
  onReveal,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lng = i18n.language
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const total = entries.reduce((sum, e) => sum + e.bytes, 0)

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="trash-backdrop"
      dialogTestId="trash-panel"
      labelledBy="trash-title"
      className="flex max-h-[80vh] w-[min(720px,calc(100vw-32px))] flex-col"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id="trash-title" className="flex items-center gap-2 text-base font-semibold text-fg">
            <Trash2 className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            {tr('trash.title')}
          </h2>
          <p className="mt-1 text-xs text-fg-muted" data-testid="trash-summary">
            {entries.length > 0
              ? tr('trash.summary', {
                  count: entries.length,
                  size: formatBytes(total, lng),
                })
              : tr('trash.emptyHint', {
                  days: retentionDays,
                  size: formatBytes(maxBytes, lng),
                })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('trash.close')}
          className="press flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="px-5 py-12 text-center" data-testid="trash-empty">
          <p className="text-sm text-fg">{tr('trash.emptyTitle')}</p>
          <p className="mt-1 text-xs text-fg-muted">{tr('trash.emptyBody')}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="trash-list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-testid="trash-row"
              className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{entry.name}</div>
                <div className="truncate font-mono text-[11px] text-fg-muted">
                  {folderOf(entry.originalPath)}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-fg-muted">
                  <span>{tr(`trash.reason.${entry.reason}`)}</span>
                  <span>{formatBytes(entry.bytes, lng)}</span>
                  <span>
                    {new Date(entry.trashedAt).toLocaleString(lng, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRestore(entry)}
                data-testid="trash-restore"
                className="press flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg hover:border-[var(--color-accent)]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {tr('trash.restore')}
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry)}
                data-testid="trash-remove"
                aria-label={tr('trash.remove')}
                className="press flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-danger"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-[11px] text-fg-muted">
          {tr('trash.retention', { days: retentionDays, size: formatBytes(maxBytes, lng) })}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReveal}
            data-testid="trash-reveal"
            className="press flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {tr('trash.reveal')}
          </button>
          {entries.length > 0 &&
            (confirmEmpty ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmEmpty(false)
                  onEmpty()
                }}
                data-testid="trash-empty-confirm"
                className="press rounded-lg bg-danger px-2.5 py-1.5 text-xs font-medium text-[var(--color-on-accent)]"
              >
                {tr('trash.emptyConfirm', { count: entries.length })}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmEmpty(true)}
                data-testid="trash-empty"
                className="press rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-muted hover:border-danger hover:text-danger"
              >
                {tr('trash.empty')}
              </button>
            ))}
        </div>
      </div>
    </ModalShell>
  )
}
