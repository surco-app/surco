import { ChevronRight } from 'lucide-react'
import type React from 'react'

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
  // One-line digest of the section's state, shown only while folded — open, the
  // controls below say the same thing. Stating even the idle state ("Off") keeps a
  // folded header unambiguous between "off" and "never looked".
  summary?: string
  // The digest's testid, named per section so tests never fish among siblings.
  summaryTestId?: string
  right?: React.ReactNode
}

export function SectionHeader({
  title,
  open,
  onToggle,
  summary,
  summaryTestId,
  right,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The button stretches across the free width (and pads a few px vertically)
          so the whole header row folds the section, not just the title's letters;
          the right-slot actions stay outside it. aria-label pins the accessible
          name to the title alone — the summary is state, not name. */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={title}
        aria-expanded={open}
        className="-my-1.5 flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span
            data-testid={summaryTestId}
            className="ml-auto min-w-0 truncate pl-3 font-normal tracking-normal normal-case tabular-nums"
          >
            {summary}
          </span>
        )}
      </button>
      {right}
    </div>
  )
}
