import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS, OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type { FormatSetting, OutputFormat, ProcessStage } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { exportButtonLabel } from '../lib/exportLabel'
import { STAGE_PROGRESS } from '../lib/progress'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'

export const FORMATS = OUTPUT_FORMATS

// The menu's reachable items in order: a disabled pick (Apple Music under FLAC) can't take
// focus, so the arrows skip it rather than stall on it.
function menuItemsOf(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? [],
  )
}

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  // The file would supersede a copy already in the library, so the button offers a
  // replacement instead of an add.
  replaces?: boolean
  done: boolean
  outputFormat: FormatSetting
  exportedFormat: OutputFormat | null
  withAppleMusic: boolean
  withEngineDj: boolean
  incomplete: boolean
  // The reason the convert is blocked (the empty required fields), shown as a tooltip on
  // the disabled button so it explains itself. Only meaningful while incomplete.
  incompleteReason?: string
  // A short form of that reason shown as the button's own text while it is blocked, so the
  // footer needs no second line to say it. The action stays in the button's name.
  blockedLabel?: string
  // True when the export writes over the original (the source's own format, or overwrite
  // mode) and renames it rather than writing a separate copy.
  inPlace: boolean
  // True when the export keeps the source's format with no filter re-rendering the audio.
  // Only then is an in-place or stale export a tag update, so the button offers "Update
  // tags" instead of a conversion.
  tagsOnly?: boolean
  // When set, the button converts the whole selection in the chosen format and labels
  // itself "Convert all (N)" instead of the single-track convert; the format menu works
  // the same, it just applies to every selected track.
  count?: number
  // The export phase the track is in while processing. With it, the button mirrors the
  // track list's row: the stage as its label and a fill at that phase's progress mark.
  // Absent until the first progress event lands (and always in multi/quiet uses).
  stage?: ProcessStage
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits in the secondary row labelled "Convert again", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  // The destination this conversion goes to and the picks on offer — the editor
  // filters them (Apple Music off non-macOS, overwrite only when Settings chose it).
  // Like the format, picking one only relabels the button for this track.
  destination: Destination
  destinations: readonly Destination[]
  onProcess: (format: FormatSetting) => void
  // When given, the button stays live while converting: clicking it cancels the in-flight
  // job instead of firing another convert. Single-only — multi cancels via the toolbar
  // batch pill — so it's absent (an inert progress bar) in the multi/quiet uses.
  onCancel?: () => void
  onSelectFormat: (format: FormatSetting) => void
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
  replaces,
  done,
  stage,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  withEngineDj,
  incomplete,
  incompleteReason,
  blockedLabel,
  inPlace,
  tagsOnly = false,
  count,
  quiet,
  destination,
  destinations,
  onProcess,
  onCancel,
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
  // Missing tags block the convert softly: aria-disabled instead of disabled keeps the
  // button in the Tab order, so the keyboard can reach it and hear why it won't run.
  const softBlocked = incomplete && !processing
  const reasonId = useId()
  const formatHeadingId = useId()
  const destinationHeadingId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The same keyboard contract as TrackContextMenu: opening lands focus on the checked
  // item, and closing hands it back to the chevron. Only when focus was left with nowhere
  // to go, though: a click outside that closed the menu keeps the focus it just set.
  useEffect(() => {
    if (!open) return
    const items = menuItemsOf(menuRef.current)
    ;(items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
    return () => {
      const at = document.activeElement
      if (!at || at === document.body) toggleRef.current?.focus()
    }
  }, [open])

  function onMenuKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    const items = menuItemsOf(menuRef.current)
    const idx = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0
    else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === -1 || items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    items[next].focus()
  }

  // 'source' names no real format, so its display text is the translated setting label
  // ("Same as source") rather than the uppercased extension every real format shows.
  const formatLabel =
    outputFormat === 'source' ? tr('settings.formats.source') : outputFormat.toUpperCase()

  const labelSpec = exportButtonLabel({
    processing,
    quiet,
    count,
    inPlace,
    tagsOnly,
    stale,
    replaces,
    done,
    withAppleMusic,
    withEngineDj,
    format: formatLabel,
    exportedFormat: exportedFormat?.toUpperCase() ?? null,
  })
  // The in-flight view mirrors the track list's row: the stage names what's
  // happening, the fill below marks where in the pipeline it is (same keys, same
  // STAGE_PROGRESS marks). Only for the prominent button — the quiet re-export
  // variant never shows a processing state.
  const liveStage = !quiet && processing ? stage : undefined
  // A single convert can be cancelled while it runs: the progress-bar button stays live and
  // a click stops the job. Only when a cancel handler is wired (single, non-quiet) and the
  // track is actually converting — the multi/quiet uses keep the inert bar.
  const cancellable = !quiet && processing && !!onCancel
  const label = liveStage
    ? tr(`trackList.stage.${liveStage}`, { format: formatLabel })
    : tr(labelSpec.key, labelSpec.options)
  const shownBlocked = softBlocked && blockedLabel ? blockedLabel : undefined
  // The fill is decorative, and a button flattens any role nested in it, so how far the
  // export has come is spoken as part of the button's name instead of a progressbar.
  const progressText = liveStage
    ? tr('trackList.progress', { percent: Math.round(STAGE_PROGRESS[liveStage] * 100) })
    : ''

  function pick(format: FormatSetting): void {
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
        // While converting, a click cancels (when cancellable) rather than firing a second
        // convert; the same button is the progress bar and its own stop control.
        onClick={cancellable ? onCancel : softBlocked ? undefined : () => onProcess(outputFormat)}
        // Cancellable keeps the button live during the convert; a non-cancellable processing
        // state still disables it outright, and missing tags only mark it aria-disabled.
        disabled={processing && !cancellable}
        aria-disabled={softBlocked || undefined}
        aria-describedby={softBlocked && incompleteReason ? reasonId : undefined}
        // The visible text is the stage, but pressing cancels: the name says both, keeping
        // the visible words first so voice control still finds it by what it shows.
        aria-label={
          cancellable
            ? tr('export.cancelWhile', { stage: `${label} ${progressText}`.trim() })
            : shownBlocked
              ? `${shownBlocked} · ${label}`
              : undefined
        }
        className={
          quiet
            ? 'press flex-1 rounded-l-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'
            : liveStage
              ? // The dimmed track + accent fill replace the usual disabled fade: the
                // button reads as a progress bar, not as a greyed-out control.
                'press relative flex-1 overflow-hidden rounded-l-lg bg-[var(--color-accent)]/40 py-2.5 text-sm font-medium text-[var(--color-on-accent)] disabled:pointer-events-none'
              : 'press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'
        }
      >
        {liveStage && (
          <span
            data-testid="process-progress"
            aria-hidden="true"
            className="progress-sweep absolute inset-y-0 left-0 bg-[var(--color-accent)] transition-[width] duration-500"
            style={{ width: `${STAGE_PROGRESS[liveStage] * 100}%` }}
          />
        )}
        {/* Converting: the stage names progress by default, and a hover or keyboard focus
            swaps in "Cancel" so the press's effect is legible before it's made. Without a
            cancel handler the stage label just stays. */}
        <span
          className={`relative ${cancellable ? 'group-hover:hidden group-focus-within:hidden' : ''}`}
        >
          {shownBlocked ?? label}
        </span>
        {progressText && <span className="sr-only">{progressText}</span>}
        {cancellable && (
          <span className="relative hidden group-hover:inline group-focus-within:inline">
            {tr('common.cancel')}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid="process-format-toggle"
        aria-label={tr('editor.chooseFormat')}
        aria-expanded={open}
        ref={toggleRef}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex w-9 items-center justify-center rounded-r-lg border border-l-0 border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-50'
            : liveStage
              ? // Matches the body's progress-bar look, or the split button would read
                // as half-faded while the fill keeps the body vivid.
                'press flex w-10 items-center justify-center rounded-r-lg border-l border-on-scrim/20 bg-[var(--color-accent)]/40 text-[var(--color-on-accent)] disabled:pointer-events-none'
              : 'press flex w-10 items-center justify-center rounded-r-lg border-l border-on-scrim/20 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-50'
        }
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {incomplete && incompleteReason && <Tooltip label={incompleteReason} />}
      {softBlocked && incompleteReason && (
        <span id={reasonId} className="sr-only">
          {incompleteReason}
        </span>
      )}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('editor.chooseFormat')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 bottom-full mb-2 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]"
        >
          <fieldset aria-labelledby={formatHeadingId} className="min-w-0">
            <p
              id={formatHeadingId}
              className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-fg-dim"
            >
              {tr('editor.menuFormat')}
            </p>
            {/* "Same as source" only means something over several files at once — a single
              track's own format IS its own format, so resolving it there is equivalent
              and more informative. Offered only when converting a selection (count set). */}
            {(count !== undefined ? FORMAT_SETTINGS : FORMATS).map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`process-format-${id}`}
                role="menuitemradio"
                aria-checked={id === outputFormat}
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
          </fieldset>
          <fieldset aria-labelledby={destinationHeadingId} className="min-w-0">
            <p
              id={destinationHeadingId}
              className="mt-1 border-t border-[var(--color-line)] px-3 pt-2 pb-0.5 text-[11px] font-medium text-fg-dim"
            >
              {tr('editor.menuDestination')}
            </p>
            {destinations.map((d) => (
              <button
                key={d}
                type="button"
                data-testid={`process-destination-${d}`}
                role="menuitemradio"
                aria-checked={d === destination}
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
          </fieldset>
        </div>
      )}
    </div>
  )
}
