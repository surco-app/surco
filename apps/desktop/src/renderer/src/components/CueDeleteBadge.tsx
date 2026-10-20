import { X } from 'lucide-react'
import type React from 'react'
import { PAD_LETTER_COLOR } from '../../../shared/rekordboxCueColors'

export function CueDeleteBadge({
  testId,
  label,
  onDelete,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  testId: string
  label: string
  onDelete: () => void
  className: string
  style?: React.CSSProperties
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
      style={style}
      className={`press absolute z-20 flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-scrim ${className}`}
    >
      <X className="h-2.5 w-2.5" strokeWidth={3} color={PAD_LETTER_COLOR} aria-hidden="true" />
    </button>
  )
}
