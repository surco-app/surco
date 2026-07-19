import { ChevronRight, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForeignTag } from '../../../shared/types'

interface ForeignTagsInspectorProps {
  foreignTags: ForeignTag[]
  foreignRemoved: string[]
  onRemove: (name: string) => void
}

// Collapsed by default and rendered nowhere when there's nothing foreign to show —
// most files carry no third-party tags, so this stays out of the way until it does.
export function ForeignTagsInspector({
  foreignTags,
  foreignRemoved,
  onRemove,
}: ForeignTagsInspectorProps): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  if (foreignTags.length === 0) return null

  return (
    <div className="border-t border-[var(--color-line)]">
      <button
        type="button"
        data-testid="foreign-tags-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-[var(--color-panel-2)]"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="text-xs text-fg-muted">
          {tr('editor.otherTags', { count: foreignTags.length })}
        </span>
      </button>
      {open && (
        <ul data-testid="foreign-tags-list" className="border-t border-[var(--color-line)]">
          {foreignTags.map((tag) => {
            const removed = foreignRemoved.includes(tag.name)
            return (
              <li
                key={tag.name}
                data-testid="foreign-tag-row"
                data-removed={removed}
                className="flex items-center gap-2 border-b border-[var(--color-line)] py-1 last:border-0"
              >
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-[11px] ${removed ? 'text-fg-muted line-through opacity-60' : 'text-fg'}`}
                >
                  {tag.name} = {tag.value}
                </span>
                <button
                  type="button"
                  data-testid="foreign-tag-remove"
                  aria-label={tag.name}
                  onClick={() => onRemove(tag.name)}
                  className="press flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
