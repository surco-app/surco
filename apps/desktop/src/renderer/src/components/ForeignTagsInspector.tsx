import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { ForeignTag } from '../../../shared/types'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

interface ForeignTagsInspectorProps {
  foreignTags: ForeignTag[]
  foreignRemoved: string[]
  onRemove: (name: string) => void
  open: boolean
  onToggle: () => void
}

// Renders nowhere when there's nothing foreign to show — most files carry no third-party
// tags, so this stays out of the way until it does. Adopts the Properties section's look
// (spacing, header, carded rows) and is a real editor section: its fold state rides the
// section store (open/onToggle from the caller), so Settings → Editor can hide or reorder it.
export function ForeignTagsInspector({
  foreignTags,
  foreignRemoved,
  onRemove,
  open,
  onToggle,
}: ForeignTagsInspectorProps): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (foreignTags.length === 0) return null

  return (
    <div
      data-testid="foreign-tags-toggle"
      className="mt-5 border-t border-[var(--color-line)] pt-5"
    >
      <SectionHeader
        title={tr('editor.otherTagsTitle')}
        open={open}
        onToggle={onToggle}
        summary={tr('editor.otherTagsSummary', { count: foreignTags.length })}
        summaryTestId="foreign-tags-summary"
      />
      <SectionBody open={open}>
        {/* Carded rows like PropertiesReadout: 1px gaps over the line-coloured backing draw
            the separators without per-row borders. One column (not two): a foreign value can
            be a long base64 blob that a half-width cell would clip. */}
        <ul
          data-testid="foreign-tags-list"
          className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]"
        >
          {foreignTags.map((tag) => {
            const removed = foreignRemoved.includes(tag.name)
            return (
              <li
                key={tag.name}
                data-testid="foreign-tag-row"
                data-removed={removed}
                className="group flex items-center gap-3 bg-[var(--color-field)] px-3 py-2"
              >
                <span
                  className={`shrink-0 font-mono text-[11px] ${removed ? 'text-fg-muted line-through opacity-60' : 'text-fg-dim'}`}
                >
                  {tag.name}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-right font-mono text-[11px] ${removed ? 'text-fg-muted line-through opacity-60' : 'text-fg'}`}
                >
                  {tag.value}
                </span>
                {/* X appears on hover — always-on would put an X on every row and clutter the
                    card. The row is a group so hover on any part reveals it; focus-visible
                    keeps it reachable by keyboard. */}
                <button
                  type="button"
                  data-testid="foreign-tag-remove"
                  aria-label={tr('editor.otherTagsRemove', { name: tag.name })}
                  onClick={() => onRemove(tag.name)}
                  className="press flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-[var(--color-panel-2)] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      </SectionBody>
    </div>
  )
}
