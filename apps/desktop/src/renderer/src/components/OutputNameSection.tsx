import { Pencil, RefreshCw } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import type { TrackItem } from '../types'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'

interface Props {
  item: TrackItem
  // The format pick, shown as the fixed extension after the editable name.
  format: OutputFormat
  // Default to the file's own name so converting keeps it; the metadata-derived
  // name is opt-in via the "Regenerate from metadata" button.
  defaultOutputName: string
  willEditInPlace: boolean
  open: boolean
  onToggle: () => void
  onChangeName: (outputName: string) => void
  onRegenerateName: () => void
  onOpenRename: () => void
}

// The output file-name section: the editable name, the regenerate-from-pattern
// button, and the pattern-builder opener. The editor hides this in multi-select and
// replaces it with the overwrite notice when overwrite mode pins the name.
export function OutputNameSection({
  item,
  format,
  defaultOutputName,
  willEditInPlace,
  open,
  onToggle,
  onChangeName,
  onRegenerateName,
  onOpenRename,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('editor.outputName')}
        open={open}
        onToggle={onToggle}
        right={
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="regenerate-output-name"
              onClick={onRegenerateName}
              className="press group relative flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2.5 text-xs font-medium hover:bg-[var(--color-line-strong)]"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {tr('editor.regenerate')}
              <Tooltip label={tr('editor.regenerateHint')} align="end" />
            </button>
            <button
              type="button"
              data-testid="customize-output-name"
              aria-label={tr('editor.regenerateCustom')}
              onClick={onOpenRename}
              className="press group relative flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              <Tooltip label={tr('editor.regenerateCustom')} align="end" />
            </button>
          </span>
        }
      />
      {open && (
        <label className="relative mt-3 block">
          <input
            data-testid="output-name"
            value={item.outputName ?? defaultOutputName}
            onChange={(e) => onChangeName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-14 pl-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-dim">
            .{format}
          </span>
        </label>
      )}
      {open && willEditInPlace && (
        <p className="mt-2 text-xs text-fg-dim" data-testid="output-name-hint">
          {tr('editor.outputNameHintInPlace')}
        </p>
      )}
    </div>
  )
}
