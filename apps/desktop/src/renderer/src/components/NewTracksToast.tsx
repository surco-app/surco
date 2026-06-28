import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingNew } from '../hooks/useTrackLibrary'

// Offers the tracks the folder watcher found after a crate was loaded. Unlike NoticeToast it
// does not auto-dismiss: the user needs time to decide, and ignoring it is a valid answer —
// the prompt simply waits, growing its count if more files are copied in.
export function NewTracksToast({
  pending,
  onLoad,
  onDismiss,
}: {
  pending: PendingNew | null
  onLoad: () => void
  onDismiss: () => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (!pending) return null

  const folder = pending.root.split('/').pop() || pending.root
  return (
    <div className="animate-pop fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-lg">
      <span data-testid="new-tracks-message" className="text-sm">
        {tr('newTracks.prompt', { count: pending.paths.length, folder })}
      </span>
      <button
        type="button"
        data-testid="new-tracks-load"
        onClick={onLoad}
        className="press rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
      >
        {tr('newTracks.load')}
      </button>
      <button
        type="button"
        data-testid="new-tracks-dismiss"
        aria-label={tr('newTracks.dismiss')}
        onClick={onDismiss}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
