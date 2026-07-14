import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat, ProcessStage } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { exportButtonLabel } from '../lib/exportLabel'
import { STAGE_PROGRESS } from '../lib/progress'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'

export const FORMATS: OutputFormat[] = ['aiff', 'alac', 'mp3', 'wav', 'flac']

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  done: boolean
  outputFormat: OutputFormat
  exportedFormat: OutputFormat | null
  withAppleMusic: boolean
  withEngineDj: boolean
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
  // The export phase the track is in while processing. With it, the button mirrors the
  // track list's row: the stage as its label and a fill at that phase's progress mark.
  // Absent until the first progress event lands (and always in multi/quiet uses).
  stage?: ProcessStage
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits in the secondary row labelled "Re-export", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  // The destination this conversion goes to and the picks on offer — the editor
  // filters them (Apple Music off non-macOS, overwrite only when Settings chose it).
  // Like the format, picking one only relabels the button for this track.
  destination: Destination
  destinations: readonly Destination[]
  onProcess: (format: OutputFormat) => void
  onSelectFormat: (format: OutputFormat) => void
  onSelectDestination: (destination: Destination) => void
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
  stage,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  withEngineDj,
  incomplete,
  incompleteReason,
  inPlace,
  count,
  quiet,
  destination,
  destinations,
  onProcess,
  onSelectFormat,
  onSelectDestination,
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
    withEngineDj,
    format: outputFormat.toUpperCase(),
    exportedFormat: exportedFormat?.toUpperCase() ?? null,
  })
  // The in-flight view mirrors the track list's row: the stage names what's
  // happening, the fill below marks where in the pipeline it is (same keys, same
  // STAGE_PROGRESS marks). Only for the prominent button — the quiet re-export
  // variant never shows a processing state.
  const liveStage = !quiet && processing ? stage : undefined
  const label = liveStage
    ? tr(`trackList.stage.${liveStage}`, { format: outputFormat.toUpperCase() })
    : tr(labelSpec.key, labelSpec.options)

  function pick(format: OutputFormat): void {
    setOpen(false)
    onSelectFormat(format)
  }

  function pickDestination(d: Destination): void {
    setOpen(false)
    onSelectDestination(d)
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
            : liveStage
              ? // The dimmed track + accent fill replace the usual disabled fade: the
                // button reads as a progress bar, not as a greyed-out control.
                'press relative flex-1 overflow-hidden rounded-l-lg bg-[var(--color-accent)]/40 py-2.5 text-sm font-medium text-[var(--color-on-accent)] disabled:pointer-events-none'
              : 'press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50'
        }
      >
        {liveStage && (
          <span
            data-testid="process-progress"
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-[var(--color-accent)] transition-[width] duration-500 animate-pulse"
            style={{ width: `${STAGE_PROGRESS[liveStage] * 100}%` }}
          />
        )}
        <span className="relative">{label}</span>
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
            : liveStage
              ? // Matches the body's progress-bar look, or the split button would read
                // as half-faded while the fill keeps the body vivid.
                'press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)]/40 text-[var(--color-on-accent)] disabled:pointer-events-none'
              : 'press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50'
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
          <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-fg-dim uppercase">
            {tr('editor.menuFormat')}
          </p>
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
          <p className="mt-1 border-t border-[var(--color-line)] px-3 pt-2 pb-0.5 text-[11px] font-medium tracking-wide text-fg-dim uppercase">
            {tr('editor.menuDestination')}
          </p>
          {destinations.map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`process-destination-${d}`}
              aria-current={d === destination ? 'true' : undefined}
              // Music can't ingest FLAC — the same pin the Settings radio applies.
              disabled={d === 'appleMusic' && outputFormat === 'flac'}
              onClick={() => pickDestination(d)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                d === destination ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              {tr(`settings.destinations.${d}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
