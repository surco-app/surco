import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from './ModalShell'
import { formatBytes, TrashBrowser, type TrashBrowserProps } from './TrashBrowser'

export { formatBytes }

type Props = Omit<TrashBrowserProps, 'header'> & { onClose: () => void }

// Surco's own trash, built out of the settings dialog's parts — the same shell, the same
// sidebar with its accent pill, the same footer — because it is the same kind of surface:
// a place you open on purpose, not a card that interrupts. It carries no dates. The OS
// trash has none either, and the only temporal fact that matters here is the one no OS
// trash has: this one deletes by itself, so a row says how long is left, and only once
// the sweep is close enough for that to be a warning.
export function TrashPanel({ onClose, ...browser }: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lng = i18n.language
  const { entries } = browser
  const total = entries.reduce((sum, e) => sum + e.bytes, 0)

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="trash-backdrop"
      dialogTestId="trash-panel"
      labelledBy="trash-title"
      // A set height, not a ceiling: the row count swings from a whole replaced crate to
      // one survivor of a filter, and a dialog that sized itself to its rows would jump —
      // sidebar, footer and all — on every click of the sidebar.
      className="flex h-[62vh] max-h-[620px] min-h-[420px] w-[min(900px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)]"
    >
      <TrashBrowser
        {...browser}
        header={
          <div className="flex items-center gap-3 px-5 pt-4 pb-3">
            <h2 id="trash-title" className="text-base font-semibold text-fg">
              {tr('trash.title')}
            </h2>
            <span className="text-xs text-fg-dim" data-testid="trash-summary">
              {entries.length > 0
                ? tr('trash.summary', { count: entries.length, size: formatBytes(total, lng) })
                : tr('trash.summaryEmpty')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('trash.close')}
              className="press ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        }
      />
    </ModalShell>
  )
}
