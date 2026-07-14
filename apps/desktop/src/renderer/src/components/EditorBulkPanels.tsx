import type { LucideIcon } from 'lucide-react'
import type React from 'react'

// The three panels a section slot shows when its per-track control has no story to tell —
// under a multi-selection, or in overwrite mode. They were written inline inside the section
// router's switch, three walls of JSX in the middle of a routing decision.

// A section slot whose per-track control is replaced by one bulk action: the section keeps
// its heading (so reordering still lands it where the user put it) and offers the single
// operation that DOES make sense across a selection.
export function BulkActionSection({
  testid,
  buttonTestid,
  title,
  label,
  icon: Icon,
  onClick,
}: {
  testid: string
  buttonTestid: string
  title: string
  label: string
  icon: LucideIcon
  onClick: () => void
}): React.JSX.Element {
  return (
    <div data-testid={testid} className="mt-6 border-t border-[var(--color-line)] pt-5">
      <p className="text-sm font-medium text-fg-muted">{title}</p>
      <button
        type="button"
        data-testid={buttonTestid}
        onClick={onClick}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}

// Overwrite mode pins the output name to the original, so the File Name section has nothing
// to edit — it states what the export will do instead. A lossy source rewritten in place is
// the one case worth colouring: that original is not coming back.
export function OverwriteNotice({
  title,
  hint,
  lossy,
}: {
  title: string
  hint: string
  lossy: boolean
}): React.JSX.Element {
  return (
    <div data-testid="overwrite-notice" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <p className="text-sm font-medium text-fg-muted">{title}</p>
      <p
        className={`mt-2 text-xs ${lossy ? 'text-danger' : 'text-fg-dim'}`}
        data-testid="overwrite-hint"
      >
        {hint}
      </p>
    </div>
  )
}
