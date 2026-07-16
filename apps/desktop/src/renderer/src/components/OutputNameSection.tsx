import { Pencil, RefreshCw } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { formatExtension } from '../../../shared/format'
import type { TrackItem } from '../types'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'

interface Props {
  item: TrackItem
  // The format pick, shown as the fixed extension after the editable name.
  format: OutputFormat
  // The name shown when the track has no manual outputName: the file's own name, or the
  // pattern-derived name when auto-apply is on (App computes which).
  defaultOutputName: string
  // Settings → Naming: when on, the pattern applies automatically, so the manual
  // "Regenerate from metadata" button is redundant and hidden (the pencil stays).
  autoApply: boolean
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
  autoApply,
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
        // The exact name the export will write, verifiable without unfolding.
        summary={`${item.outputName ?? defaultOutputName}.${formatExtension(format)}`}
        summaryTestId="output-name-summary"
        // Both buttons act on the name field below, so they fold with the section;
        // folded, the header keeps only the summary of what will be written.
        right={
          open && (
            <span className="flex items-center gap-1.5">
              {!autoApply && (
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
              )}
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
          )
        }
      />
      <SectionBody open={open}>
        <label className="relative mt-3 block">
          <input
            data-testid="output-name"
            value={item.outputName ?? defaultOutputName}
            onChange={(e) => onChangeName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-14 pl-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-dim">
            .{formatExtension(format)}
          </span>
        </label>
        {willEditInPlace && (
          <p className="mt-2 text-xs text-fg-dim" data-testid="output-name-hint">
            {tr('editor.outputNameHintInPlace')}
          </p>
        )}
      </SectionBody>
    </div>
  )
}
