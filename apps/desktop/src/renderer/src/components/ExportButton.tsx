import { ChevronDown, RotateCw } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS, OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type {
  FormatSetting,
  LibraryCopyAction,
  OutputFormat,
  ProcessStage,
} from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { exportButtonLabel } from '../lib/exportLabel'
import type { LibraryCopyOffer } from '../lib/libraryCopy'
import { panelDurationMs, standardEasing } from '../lib/motion'
import { STAGE_PROGRESS } from '../lib/progress'
import type { TrackItem } from '../types'
import { FormatDestinationMenu } from './FormatDestinationMenu'
import {
  FORMAT_TOGGLE_BOX,
  FORMAT_TOGGLE_BOX_NAME,
  SPLIT_BODY,
  SPLIT_BODY_QUIET,
  SPLIT_BODY_READY,
  SPLIT_TOGGLE_DIMMED,
  SPLIT_TOGGLE_FORMAT,
  SPLIT_TOGGLE_QUIET,
  SPLIT_TOGGLE_READY,
  useSplitMenu,
} from './SplitButton'
import { Tooltip } from './Tooltip'

export const FORMATS = OUTPUT_FORMATS

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  // A copy of this track already in a library: the body runs the remembered Update or Replace
  // on it instead of converting a second file beside it.
  libraryCopy?: LibraryCopyOffer
  onLibraryAction?: (action: LibraryCopyAction) => void
  // Remembers the action picked from the menu as the body's next press.
  onLibraryActionChange?: (action: LibraryCopyAction) => void
  done: boolean
  outputFormat: FormatSetting
  // The format the dropdown half displays and the menu marks, when it differs from the pick:
  // a selection whose plan writes one other format (kept MP3s under an AIFF setting). Picking
  // and converting still use outputFormat.
  shownFormat?: FormatSetting
  exportedFormat: OutputFormat | null
  incomplete: boolean
  // The reason the convert is blocked (the empty required fields), shown as a tooltip on
  // the disabled button so it explains itself. Only meaningful while incomplete.
  incompleteReason?: string
  // A short form of that reason shown as the button's own text while it is blocked, so the
  // footer needs no second line to say it. The action stays in the button's name.
  blockedLabel?: string
  // A press on the blocked button: the editor answers it by taking the user to the field
  // the face names.
  onBlockedPress?: () => void
  // True when the export writes over the original (the source's own format, or overwrite
  // mode) and renames it rather than writing a separate copy.
  inPlace: boolean
  // True when the export keeps the source's format with no filter re-rendering the audio.
  // Only then is an in-place or stale export a tag update, so the button offers "Update
  // tags" instead of a conversion.
  tagsOnly?: boolean
  sameFormat?: boolean
  addsToMusic?: boolean
  upToDate?: boolean
  narrow?: boolean
  // A selection's own words, worked out from the batch plan; a track's come from its state.
  label?: string
  // The keyboard chord shown on hover beside the label.
  hint?: string
  // Reports the label the button wears, so the palette's convert entry can name the same action.
  onLabelChange?: (label: string) => void
  // What the hover says in place of the label, when the label alone does not tell it all.
  tip?: string
  // "Same as source", offered only where it differs from a real format.
  offerSource?: boolean
  // Clearing the list after a batch, offered as the menu's last option where it applies.
  clearAfter?: boolean
  onToggleClearAfter?: () => void
  // The export phase the track is in while processing. With it, the button mirrors the
  // track list's row: the stage as its label and a fill at that phase's progress mark.
  // Absent until the first progress event lands (and always in multi/quiet uses).
  stage?: ProcessStage
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits among the done footer's actions labelled "Convert again", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  // The destination this conversion goes to and the picks on offer — the editor
  // filters them (Apple Music off non-macOS, overwrite only when Settings chose it).
  // Like the format, picking one only relabels the button for this track.
  destination: Destination
  destinations: readonly Destination[]
  onProcess: (format: FormatSetting) => void
  // When given, the button stays live while converting: clicking it cancels the in-flight
  // job instead of firing another convert. Single-only, so it's absent (an inert progress
  // bar) in the multi/quiet uses.
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
  libraryCopy,
  onLibraryAction,
  onLibraryActionChange,
  done,
  stage,
  outputFormat,
  shownFormat: pickedShownFormat = outputFormat,
  exportedFormat,
  incomplete,
  incompleteReason,
  blockedLabel,
  onBlockedPress,
  inPlace,
  tagsOnly = false,
  sameFormat = false,
  addsToMusic = false,
  upToDate = false,
  narrow = false,
  label: batchLabel,
  hint,
  onLabelChange,
  tip,
  offerSource = false,
  clearAfter,
  onToggleClearAfter,
  quiet,
  destination,
  destinations,
  onProcess,
  onCancel,
  onSelectFormat,
  onSelectDestination,
}: ExportButtonProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  const processing = status === 'processing'
  // Missing tags block only the convert, and softly: aria-disabled instead of disabled keeps
  // the button in the Tab order, so the keyboard can reach it and hear why it won't run. The
  // format menu stays open for a track and a selection alike: picking a format converts
  // nothing, and in a selection the format can be what leaves tracks out.
  const softBlocked = incomplete && !processing
  const reasonId = useId()
  const upToDateId = useId()
  const heldId = useId()

  // 'source' names no real format, so its display text is the translated setting label
  // ("Same as source") rather than the uppercased extension every real format shows.
  const formatLabel =
    outputFormat === 'source' ? tr('settings.formats.source') : outputFormat.toUpperCase()

  const labelSpec = exportButtonLabel({
    processing,
    quiet,
    inPlace,
    tagsOnly,
    sameFormat,
    addsToMusic,
    stale,
    libraryAction: libraryCopy?.action,
    libraryBetter: libraryCopy?.better,
    done,
    format: formatLabel,
    exportedFormat: exportedFormat?.toUpperCase() ?? null,
  })
  const libraryAction = labelSpec.library
  // Update rewrites only the copy's tags, so what gets written keeps the copy's own format
  // whatever the pick says.
  const shownFormat =
    libraryAction === 'update' && libraryCopy?.keptFormat
      ? libraryCopy.keptFormat
      : pickedShownFormat
  // A copy still being compared may yet turn out to be another version, and one without a
  // path gives nothing to act on: the press waits for both.
  const libraryHeld = !!libraryAction && !!libraryCopy?.held

  // The dropdown half shows the format the button writes (shownFormat). Every candidate is stacked in one grid cell
  // and only the chosen one is visible, so the half is as wide as the longest name in the
  // app's language and switching formats never moves either half.
  const shortName = (f: FormatSetting): string =>
    f === 'source' ? tr('editor.formatSourceShort') : f.toUpperCase()
  const formatPicker = (
    <span className="relative grid text-xs opacity-80">
      {FORMAT_SETTINGS.map((f) => (
        <span
          key={f}
          data-testid={f === shownFormat ? 'process-format-current' : undefined}
          aria-hidden={f !== shownFormat || undefined}
          className={`[grid-area:1/1] ${f === shownFormat ? '' : 'invisible'}`}
        >
          {shortName(f)}
        </span>
      ))}
    </span>
  )

  // The in-flight view mirrors the track list's row: the stage names what's
  // happening, the fill below marks where in the pipeline it is (same keys, same
  // STAGE_PROGRESS marks). Only for the prominent button — the quiet re-export
  // variant never shows a processing state.
  const liveStage = !quiet && processing ? stage : undefined
  // A single convert can be cancelled while it encodes: the progress-bar button stays live
  // and a click stops the job. Only when a cancel handler is wired (single, non-quiet) and
  // the job is in the encode, the one stage a cancel reaches — writing the cover or adding
  // to a library runs to the end, so offering Cancel there promised a stop that never came.
  const cancellable =
    !quiet && processing && !!onCancel && (stage === 'converting' || stage === 'tags')
  const idleLabel = batchLabel ?? tr(labelSpec.key, labelSpec.options)
  const label = liveStage ? tr(`trackList.stage.${liveStage}`, { format: formatLabel }) : idleLabel
  // The palette names the action after the face the footer shows, and the up-to-date row
  // replaces the normal button with "Update anyway".
  const reportedLabel = upToDate && !quiet ? tr('editor.updateAnyway') : idleLabel
  useEffect(() => {
    onLabelChange?.(reportedLabel)
    return () => onLabelChange?.('')
  }, [reportedLabel, onLabelChange])
  const shownBlocked = softBlocked && blockedLabel ? blockedLabel : undefined
  // The face keeps the last blocking text after it clears, so it can roll out of view
  // instead of vanishing the instant the field is filled.
  const [lastBlocked, setLastBlocked] = useState(blockedLabel)
  if (blockedLabel && blockedLabel !== lastBlocked) setLastBlocked(blockedLabel)
  const [shaking, setShaking] = useState(false)
  // Only the prominent idle button swaps faces; the quiet re-export and the progress bar
  // keep their own looks.
  const swapsFace = !quiet && !liveStage
  const faceBlocked = swapsFace && !!shownBlocked
  const toggleDimmed = swapsFace && softBlocked && !faceBlocked
  // The fill is decorative, and a button flattens any role nested in it, so how far the
  // export has come is spoken as part of the button's name instead of a progressbar.
  const progressText = liveStage
    ? tr('trackList.progress', { percent: Math.round(STAGE_PROGRESS[liveStage] * 100) })
    : ''
  const progressRef = useRef<HTMLSpanElement>(null)
  const prevUpToDate = useRef(upToDate)
  const upToDateSwapped = useRef(false)
  const hadStage = useRef(!!liveStage)
  useLayoutEffect(() => {
    const started = !hadStage.current && !!liveStage
    hadStage.current = !!liveStage
    const fill = progressRef.current
    if (!started || !fill) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    fill.animate?.([{ transform: 'scaleX(0)', offset: 0 }], {
      duration: panelDurationMs(),
      easing: standardEasing(),
    })
  }, [liveStage])

  function pick(format: FormatSetting): void {
    setOpen(false)
    onSelectFormat(format)
  }

  function pickDestination(d: Destination): void {
    setOpen(false)
    onSelectDestination(d)
  }

  function pickLibraryAction(action: LibraryCopyAction): void {
    setOpen(false)
    onLibraryActionChange?.(action)
    // The stars warning shows only once the body says Replace, so a Replace that costs them
    // waits for the body's press: run from here, the DJ would read the warning too late.
    const warnsFirst = action === 'replace' && !!libraryCopy?.replaceLosesStars
    if (!libraryCopy?.held && !softBlocked && !warnsFirst) onLibraryAction?.(action)
  }

  // Only while the body acts on the copy: an in-place update or a re-export outranks it there,
  // and the menu must not run an action the button never shows. Another version with nothing
  // picked converts from the body, yet the menu keeps both actions on it for the DJ to take.
  const otherVersionConverts =
    !!libraryCopy?.otherVersion && !libraryCopy.action && labelSpec.key === 'editor.convertAction'
  const libraryMenu = libraryCopy &&
    (!!libraryAction || otherVersionConverts) && {
      heading: `${libraryCopy.name} · ${libraryCopy.format}`,
      action: libraryCopy.action,
      updatable: libraryCopy.updatable !== false,
      replaceable: libraryCopy.replaceable !== false,
      onPick: pickLibraryAction,
    }

  if (prevUpToDate.current !== upToDate) {
    upToDateSwapped.current = true
    prevUpToDate.current = upToDate
  }

  if (upToDate && !processing && !quiet) {
    return (
      <div
        key="up-to-date"
        data-testid="convert-up-to-date-row"
        data-swapped={upToDateSwapped.current ? 'true' : 'false'}
        className={`${upToDateSwapped.current ? 'animate-footer-swap ' : ''}flex h-10 items-center`}
      >
        {/* The normal split button's geometry with the accent fill swapped for an outline, so
          the footer keeps one shape and an edit only brings the fill back. */}
        <div ref={ref} className="relative flex flex-1 self-stretch">
          <button
            type="button"
            data-testid="convert-update-anyway"
            aria-describedby={upToDateId}
            onClick={() => onProcess(outputFormat)}
            className={`press relative -mr-px flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-l-lg ${narrow ? 'px-2' : 'px-3'} text-sm font-medium text-fg hover:bg-[var(--color-hover)]`}
          >
            <span aria-hidden="true" className="text-good">
              ✓
            </span>
            <span className="truncate">{tr('editor.updateAnyway')}</span>
            <Tooltip label={tr('editor.updateAnyway')} hint={hint} hoverOnly />
          </button>
          <span id={upToDateId} data-testid="convert-up-to-date" className="sr-only">
            {tr('editor.upToDate')}
          </span>
          <button
            type="button"
            data-testid="process-format-toggle"
            aria-label={tr('editor.formatDestinationToggle', { format: shortName(shownFormat) })}
            aria-expanded={open}
            ref={toggleRef}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
            data-box={FORMAT_TOGGLE_BOX_NAME}
            className={`${SPLIT_TOGGLE_FORMAT} text-fg-dim before:bg-[var(--color-line-strong)] hover:bg-[var(--color-hover)]`}
          >
            {formatPicker}
            <ChevronDown
              aria-hidden="true"
              className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
          {/* Drawn over both halves so one outline wraps the pair and the hover fills stay
            inside it, with the short divider as the only seam. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 rounded-lg ring-1 ring-[var(--color-line-strong)] ring-inset"
          />
          {open && (
            <FormatDestinationMenu
              menuRef={menuRef}
              onMenuKeyDown={onMenuKeyDown}
              offerSource={offerSource}
              outputFormat={pickedShownFormat}
              exportedFormat={exportedFormat}
              destination={destination}
              destinations={destinations}
              onPickFormat={pick}
              onPickDestination={pickDestination}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    // A disabled control fires no pointer events of its own, so the buttons go
    // pointer-events-none while blocked and this wrapper carries the hover — letting the
    // "why is this disabled" tooltip below appear over the greyed-out button.
    <div className="flex items-center gap-3">
      <div
        data-testid="process-btn-wrap"
        ref={ref}
        data-blocked={faceBlocked || undefined}
        onAnimationEnd={(e) => {
          if (e.animationName === 'blocked-shake') setShaking(false)
        }}
        className={`group relative flex flex-1 ${swapsFace ? 'process-wrap' : ''} ${shaking ? 'animate-blocked-shake' : ''}`}
      >
        <button
          type="button"
          data-testid="process-btn"
          // While converting, a click cancels (when cancellable) rather than firing a second
          // convert; the same button is the progress bar and its own stop control. Blocked,
          // a click shakes the button once and hands the press to the editor.
          onClick={
            cancellable
              ? (e) => {
                  // The double-click that started the convert lands its second click here,
                  // after the button became the cancel control.
                  if (e.detail > 1) return
                  onCancel?.()
                }
              : softBlocked
                ? () => {
                    setShaking(true)
                    onBlockedPress?.()
                  }
                : libraryHeld
                  ? undefined
                  : libraryAction
                    ? () => onLibraryAction?.(libraryAction)
                    : () => onProcess(outputFormat)
          }
          // Cancellable keeps the button live during the convert; a non-cancellable processing
          // state still disables it outright, and missing tags only mark it aria-disabled.
          disabled={processing && !cancellable}
          aria-disabled={softBlocked || libraryHeld || undefined}
          aria-describedby={
            softBlocked && incompleteReason ? reasonId : libraryHeld ? heldId : undefined
          }
          // The visible text is the stage, but pressing cancels: the name says both, keeping
          // the visible words first so voice control still finds it by what it shows.
          aria-label={
            cancellable
              ? tr('export.cancelWhile', { stage: `${label} ${progressText}`.trim() })
              : faceBlocked
                ? `${shownBlocked} · ${label}`
                : quiet
                  ? label
                  : undefined
          }
          className={
            quiet
              ? 'press flex h-8 w-8 items-center justify-center rounded-l-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40'
              : liveStage
                ? // The dimmed track + accent fill replace the usual disabled fade: the
                  // button reads as a progress bar, not as a greyed-out control.
                  'press relative -mr-px flex-1 overflow-hidden rounded-l-lg bg-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-ink))] py-2.5 text-sm font-medium text-[var(--color-on-accent)] disabled:pointer-events-none'
                : `${SPLIT_BODY} ${faceBlocked ? SPLIT_BODY_QUIET : SPLIT_BODY_READY}`
          }
        >
          {swapsFace && (
            <span aria-hidden="true" data-on={!faceBlocked || undefined} className="process-fill" />
          )}
          {liveStage && (
            <span
              ref={progressRef}
              data-testid="process-progress"
              aria-hidden="true"
              className="progress-sweep absolute inset-0 origin-left bg-[var(--color-accent)] transition-transform duration-240 ease-standard"
              style={{ transform: `scaleX(${STAGE_PROGRESS[liveStage]})` }}
            />
          )}
          {/* Converting: the stage names progress by default, and a hover or keyboard focus
            swaps in "Cancel" so the press's effect is legible before it's made. Without a
            cancel handler the stage label just stays. */}
          {swapsFace ? (
            <span className="process-face min-w-0 max-w-full px-3">
              {lastBlocked && (
                <span
                  data-testid={faceBlocked ? 'process-blocked-face' : undefined}
                  aria-hidden={!faceBlocked || undefined}
                  className="process-face-blocked"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
                  {lastBlocked}
                </span>
              )}
              <span
                aria-hidden={faceBlocked || undefined}
                className="process-face-action min-w-0 max-w-full"
              >
                <span className="truncate">{label}</span>
              </span>
            </span>
          ) : quiet ? (
            <>
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              <Tooltip label={label} />
            </>
          ) : (
            <span
              className={`relative ${cancellable ? 'group-hover:hidden group-focus-within:hidden' : ''}`}
            >
              {label}
            </span>
          )}
          {progressText && <span className="sr-only">{progressText}</span>}
          {(hint || tip) && !softBlocked && !libraryHeld && (
            <Tooltip label={tip ?? label} hint={hint} />
          )}
          {cancellable && (
            <span className="relative hidden group-hover:inline group-focus-within:inline">
              {tr('common.cancel')}
            </span>
          )}
        </button>
        <button
          type="button"
          data-testid="process-format-toggle"
          aria-label={
            quiet
              ? tr('editor.chooseFormat')
              : tr('editor.formatDestinationToggle', { format: shortName(shownFormat) })
          }
          aria-expanded={open}
          ref={toggleRef}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          disabled={processing}
          data-box={quiet ? undefined : FORMAT_TOGGLE_BOX_NAME}
          className={
            quiet
              ? 'press flex h-8 w-6 items-center justify-center rounded-r-lg border border-l-0 border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:pointer-events-none disabled:opacity-40'
              : liveStage
                ? // Matches the body's progress-bar look, or the split button would read
                  // as half-faded while the fill keeps the body vivid.
                  `press relative flex items-center justify-center ${FORMAT_TOGGLE_BOX} rounded-r-lg bg-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-ink))] before:absolute before:inset-y-2.5 before:left-0 before:z-10 before:w-px before:bg-[var(--color-on-accent)]/20 text-[var(--color-on-accent)] disabled:pointer-events-none`
                : `${SPLIT_TOGGLE_FORMAT} ${faceBlocked ? SPLIT_TOGGLE_QUIET : toggleDimmed ? SPLIT_TOGGLE_DIMMED : SPLIT_TOGGLE_READY}`
          }
        >
          {swapsFace && (
            <span
              aria-hidden="true"
              data-testid="process-format-fill"
              data-on={(!faceBlocked && !toggleDimmed) || undefined}
              className="process-fill"
            />
          )}
          {!quiet && formatPicker}
          <ChevronDown
            aria-hidden="true"
            className={`relative h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {incomplete && incompleteReason && <Tooltip label={incompleteReason} />}
        {softBlocked && incompleteReason && (
          <span id={reasonId} className="sr-only">
            {incompleteReason}
          </span>
        )}
        {libraryHeld && !softBlocked && (
          <>
            <Tooltip label={tr('editor.libraryStateMeasuring')} />
            <span id={heldId} className="sr-only">
              {tr('editor.libraryStateMeasuring')}
            </span>
          </>
        )}
        {open && (
          <FormatDestinationMenu
            menuRef={menuRef}
            onMenuKeyDown={onMenuKeyDown}
            offerSource={offerSource}
            outputFormat={pickedShownFormat}
            exportedFormat={exportedFormat}
            destination={destination}
            destinations={destinations}
            onPickFormat={pick}
            onPickDestination={pickDestination}
            clearAfter={clearAfter}
            onToggleClearAfter={onToggleClearAfter}
            libraryCopy={libraryMenu || undefined}
          />
        )}
      </div>
    </div>
  )
}
