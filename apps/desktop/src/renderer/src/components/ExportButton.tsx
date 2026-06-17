import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { exportButtonLabel } from '../lib/exportLabel'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'

export const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  done: boolean
  outputFormat: OutputFormat
  exportedFormat: OutputFormat | null
  withAppleMusic: boolean
  incomplete: boolean
  // The reason the convert is blocked (the empty required fields), shown as a tooltip on
  // the disabled button so it explains itself. Only meaningful while incomplete.
  incompleteReason?: string
  // True when the chosen format is the source's own: the export edits the original in
  // place and renames it rather than writing a converted copy, so the button offers to
  // "Update" instead of promising a conversion.
  inPlace: boolean
  // When set, the button converts the whole selection in the chosen format and labels
  // itself "Convert all (N)" instead of the single-track convert; the format menu works
  // the same, it just applies to every selected track.
  count?: number
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits in the secondary row labelled "Re-export", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  onProcess: (format: OutputFormat) => void
  onSelectFormat: (format: OutputFormat) => void
}

// A split button: the body exports in the currently chosen format (seeded from
// Settings), the chevron opens a menu to switch which format that is. Picking a
// format only relabels the button — it never converts on the spot, so a misclick
// can't write a file; the deliberate click on the body is what exports. The control
// stays visible after a track is done so re-exporting to another format never
// means reloading the file or touching Settings.
export function ExportButton({
  status,
  stale,
  done,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  incomplete,
  incompleteReason,
  inPlace,
  count,
  quiet,
  onProcess,
  onSelectFormat,
}: ExportButtonProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const processing = status === 'processing'
  // A track missing required tags cannot be converted, so the gate covers the
  // main action and the format menu alike.
  const blocked = processing || incomplete

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const labelSpec = exportButtonLabel({
    processing,
    quiet,
    count,
    inPlace,
    stale,
    done,
    withAppleMusic,
    format: outputFormat.toUpperCase(),
  })
  const label = tr(labelSpec.key, labelSpec.options)

  function pick(format: OutputFormat): void {
    setOpen(false)
    onSelectFormat(format)
  }

  return (
    // A disabled control fires no pointer events of its own, so the buttons go
    // pointer-events-none while blocked and this wrapper carries the hover — letting the
    // "why is this disabled" tooltip below appear over the greyed-out button.
    <div
      data-testid="process-btn-wrap"
      ref={ref}
      className={`group relative flex ${quiet ? 'flex-1' : ''}`}
    >
      <button
        type="button"
        data-testid="process-btn"
        onClick={() => onProcess(outputFormat)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex-1 rounded-l-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-50'
            : 'press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50'
        }
      >
        {label}
      </button>
      <button
        type="button"
        data-testid="process-format-toggle"
        aria-label={tr('editor.chooseFormat')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex w-9 items-center justify-center rounded-r-lg border border-l-0 border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-50'
            : 'press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50'
        }
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {incomplete && incompleteReason && <Tooltip label={incompleteReason} />}
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-lg">
          {FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`process-format-${id}`}
              aria-current={id === outputFormat ? 'true' : undefined}
              onClick={() => pick(id)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] ${
                id === outputFormat ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              {tr(`settings.formats.${id}`)}
              {id === exportedFormat && (
                <Check className="h-3.5 w-3.5 text-good" strokeWidth={2.5} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
