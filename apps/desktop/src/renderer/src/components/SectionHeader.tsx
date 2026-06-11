import { ChevronRight } from 'lucide-react'
import type React from 'react'

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
  right?: React.ReactNode
}

export function SectionHeader({
  title,
  open,
  onToggle,
  right,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {title}
      </button>
      {right}
    </div>
  )
}
