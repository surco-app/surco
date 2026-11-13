import {
  ArrowUpRight,
  Clock,
  Loader2,
  Music,
  SlidersVertical,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type {
  FormatSetting,
  MusicOp,
  NormalizeConfig,
  OutputFormat,
  PlaylistSource,
  SpectrumVerdict,
} from '../../../shared/types'
import { PLACE_ORDER, type PlaceCheck } from '../../../shared/verification'
import { type CleanupOffer, cleanupCount } from '../hooks/useConfirmFlows'
import type { StaleLibraryCopy } from '../lib/appleMusicLibrary'
import type { Destination } from '../lib/destination'
import { openFeedback } from '../lib/feedback'
import { formatUpTo } from '../lib/numberFormat'
import { isMacOS } from '../lib/platform'
import { gradedExt, isLosslessContainer, isLossyContainer } from '../lib/quality'
import type { SelectionStatus } from '../lib/selectionStatus'
import { trackQuality } from '../lib/triage'
import type { TrackItem } from '../types'
import { BatchPlan } from './BatchPlan'
import { BatchRun } from './BatchRun'
import { DoneMenu } from './DoneMenu'
import { ExportButton } from './ExportButton'
import { SOURCE_ICON } from './SourceRail'
import { FOOTER_BAR } from './SplitButton'
import { Tooltip } from './Tooltip'
import { detailText, VerifiedPopover } from './VerifiedPopover'

// The places whose detail keys carry another prefix than the place's own name.
const MUSIC_LINE: Record<MusicOp, string> = {
  added: 'addedToAppleMusic',
  updated: 'updatedInAppleMusic',
  replaced: 'replacedInAppleMusic',
}

const DETAIL_PREFIX: Partial<Record<PlaceCheck['place'], string>> = { appleMusic: 'music' }

// The one place the amber line names when several fail: a wrong answer before a place that
// could not be read, then the file before the libraries that follow it, since a library
// pointing at a bad file is fixed by fixing the file.
function worstCheck(checks: PlaceCheck[]): PlaceCheck | undefined {
  const rank = (c: PlaceCheck) =>
    (c.state === 'mismatch' ? 0 : c.state === 'unreadable' ? 1 : 2) * PLACE_ORDER.length +
    PLACE_ORDER.indexOf(c.place)
  const failed = checks.filter((c) => c.state === 'mismatch' || c.state === 'unreadable')
  return failed.sort((a, b) => rank(a) - rank(b))[0]
}

const ICON_BUTTON =
  'press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-dim hover:bg-[var(--color-hover)]'

interface ConvertFooterProps {
  item: TrackItem
  spectrum: SpectrumVerdict | undefined
  isMulti: boolean
  // Size of the multi-selection, for the "Convert all (N)" label and the done counts.
  selectedCount: number
  // How many of them the batch converts, for the plan's count, so it matches the header's.
  readyCount?: number
  // The footer's aggregate view of the selection (done block, reveal, Apple Music).
  status: SelectionStatus
  stale: boolean
  // Whether this track would supersede a copy already in the library.
  replaces?: boolean
  // The library's copy measured better than this file.
  libraryBetter?: boolean
  done: boolean
  incomplete: boolean
  // Why the convert is blocked (the empty required fields), surfaced as the button's
  // tooltip. In multi it covers the whole selection; undefined when nothing is missing.
  incompleteReason?: string
  // The same block said short enough for the main button's face (a count past two missing
  // fields), since the full reason can list every required field.
  incompleteSummary?: string
  // What the batch leaves out of a multi-selection and why, in the header's own words; the
  // plan shows it even while the rest converts.
  leftOut?: string
  onBlockedPress?: () => void
  willEditInPlace: boolean
  tagsOnly: boolean
  sameFormat: boolean
  upToDate: boolean
  // The editor's one-shot destination pick and the choices its split-button menu
  // offers, pre-filtered by the editor (platform, configured overwrite).
  destination: Destination
  destinations: readonly Destination[]
  format: FormatSetting
  exportedFormat: OutputFormat | null
  // The format whose Apple Music eligibility gates the add button: the pick in multi
  // mode (what will be written), the exported file's in single.
  musicExt: FormatSetting | null
  normalizeCfg: NormalizeConfig
  onOpenNormalize: () => void
  onSelectFormat: (format: FormatSetting) => void
  onSelectDestination: (destination: Destination) => void
  // Pre-resolved by the editor: converts the selection in multi mode, the open track
  // in single, so the footer never forks on it.
  onProcess: (format: FormatSetting) => void
  // Cancels the in-flight single conversion; the primary button turns into a cancel while
  // it runs.
  onCancel?: () => void
  onConvertSelection?: () => void
  batchRun?: { done: number; total: number } | null
  onCancelBatch?: () => void
  onAddToAppleMusic?: () => void
  // The library copy this track's add superseded (the old rip the fresh copy replaces),
  // resolved by the editor from the library snapshot: its persistent ID plus the raw
  // label the confirm dialog names it by. Null when there is nothing to replace.
  staleMusicCopy?: StaleLibraryCopy | null
  // The file this conversion SUPERSEDED, once the replacement finished: it left Apple
  // Music and rekordbox now follows the new file, so nothing references it any more.
  // Null when the conversion replaced nothing, or the file is already trashed.
  supersededPath?: string | null
  // One quiet link for everything the conversion left behind: the original, the
  // superseded files (one per track in multi, from selectionStatus) and the old Apple
  // Music copy. App confirms with a dialog that lists each before anything moves.
  onCleanUp?: (offer: CleanupOffer) => void
  // Opens the DJ-app collection export — offered once the export landed, since the
  // collection file references the converted copies.
  onExportCollection: () => void
  revealIn?: readonly PlaylistSource[]
  onRevealIn?: (source: PlaylistSource) => void
  // Asks main to re-check (or rerun) the track whose re-read did not add up.
  onRetryVerification?: (trackId: string) => Promise<void>
  // Opens the copies of originals at this track, for a source a conversion in place retired.
  onOpenOriginals?: () => void
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome with its
// inline links (reveal/clean up) beside the next steps (Apple Music, DJ app, re-export).
export function ConvertFooter({
  item,
  spectrum,
  isMulti,
  selectedCount,
  readyCount,
  status,
  stale,
  replaces,
  libraryBetter,
  done,
  incomplete,
  incompleteReason,
  incompleteSummary,
  leftOut,
  onBlockedPress,
  willEditInPlace,
  tagsOnly,
  sameFormat,
  upToDate,
  destination,
  destinations,
  format,
  exportedFormat,
  musicExt,
  normalizeCfg,
  onOpenNormalize,
  onSelectFormat,
  onSelectDestination,
  onProcess,
  onCancel,
  onConvertSelection,
  batchRun,
  onCancelBatch,
  onAddToAppleMusic,
  staleMusicCopy,
  supersededPath,
  onCleanUp,
  onExportCollection,
  revealIn = [],
  onRevealIn,
  onRetryVerification,
  onOpenOriginals,
}: ConvertFooterProps): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const {
    showDone,
    revealPath,
    inMusicLibraryOnly,
    canDeleteOriginal,
    musicAdding,
    musicAdded,
    musicError,
    musicOp,
    tagsOnly: exportedTagsOnly,
  } = status
  // The Apple Music slot plays three roles for a single track that has a library
  // copy (the persistent ID a previous add stored): out of sync it offers "Update"
  // — an "Add" would import a duplicate —, in sync it becomes the reveal that jumps
  // to the copy in Music, and it no longer needs an output file or a Music-friendly
  // format, since a sync touches only the existing library entry. Multi-select
  // keeps the plain add semantics: the sweep resolves add-vs-update per track.
  const hasMusicCopy = !isMulti && !!item.musicPersistentId
  const showInMusic = hasMusicCopy && musicAdded
  const musicCopyId = item.musicPersistentId
  const revealsInMusic = isMacOS() && showInMusic && !!musicCopyId
  // Sent to Apple Music, the track went to the library even when an in-place export left
  // the rewritten source behind: the folder is where it came from, so it is not offered.
  const addedToMusic = inMusicLibraryOnly || (destination === 'appleMusic' && musicAdded)
  const revealInMusic = (): void => {
    if (musicCopyId) void window.api.revealAppleMusic(musicCopyId)
  }
  const cleanup: CleanupOffer = {
    originalPath: canDeleteOriginal ? item.inputPath : null,
    superseded: isMulti
      ? status.superseded
      : supersededPath
        ? [{ trackId: item.id, path: supersededPath }]
        : [],
    staleMusicCopy:
      !isMulti && musicAdded && item.verification?.status === 'ok' && staleMusicCopy
        ? staleMusicCopy
        : null,
  }
  const cleanupFiles = !isMulti && item.replacesPath ? 0 : cleanupCount(cleanup)
  // A single track's re-read gates its done line: "Comprobando…" from the job's last stage
  // until every check is back, the line of always (with its ✓) only once all are ok, and
  // the programs still to apply a queued write named in place of the ✓. A mismatch keeps
  // the success line away for the amber line that answers it. A track with no verification
  // was never re-read, so it reads plain: no ✓, no shield. Multi keeps its counts.
  const verification = isMulti ? undefined : item.verification
  const unverified = !isMulti && !verification
  // A batch counts what its re-read found, not what was sent. The ✓ vouches for the
  // verified count once nothing is on its way (pending or still checking); a batch where
  // every track is still checking reads like a single one. A batch never re-read keeps the
  // sent count, without the ✓.
  const batch = isMulti
    ? (status.batch ?? {
        ok: 0,
        mismatch: 0,
        pending: 0,
        checking: 0,
        unverified: selectedCount,
        pendingPlaces: [],
      })
    : undefined
  const batchSettled = !!batch && batch.pending === 0 && batch.checking === 0
  const batchAllChecking =
    !!batch &&
    batch.checking > 0 &&
    batch.ok + batch.mismatch + batch.pending + batch.unverified === 0
  const batchReread = !!batch && batch.ok + batch.mismatch + batch.pending + batch.checking > 0
  const checking = isMulti
    ? showDone && batchAllChecking
    : (showDone && verification?.status === 'checking') ||
      (item.status === 'processing' && item.stage === 'verify')
  const pendingPlaces = batch
    ? batch.pendingPlaces.map((p) => tr(`verify.places.${p}`))
    : verification?.status === 'pending'
      ? verification.checks
          .filter((c) => c.state === 'pending')
          .map((c) => tr(`verify.places.${c.place}`))
      : []
  const pendingPrograms =
    pendingPlaces.length > 0
      ? new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(pendingPlaces)
      : null
  const verifyMismatch = verification?.status === 'mismatch'
  const worst = verifyMismatch ? worstCheck(verification.checks) : undefined
  // Offered while some failed place is one a retry can change.
  const canRetry =
    verifyMismatch &&
    verification.checks.some(
      (c) => (c.state === 'mismatch' || c.state === 'unreadable') && !c.final,
    )
  const keptOriginal =
    worst?.detail.key === 'fileSourceGone' && Number(worst.detail.params?.kept) === 1
  // A retry reads back as checking until its answer lands, and cannot be pressed twice.
  // One main refused says only that the place could not be checked (its message is not
  // the DJ's to read), and only until the next verification arrives with its own answer.
  const [retrying, setRetrying] = useState(false)
  const [retryFailedOn, setRetryFailedOn] = useState<typeof verification>(undefined)
  const retryFailed = !!verification && retryFailedOn === verification
  // The button keeps focus while it runs (aria-disabled, not disabled), and an answered retry
  // hands it to the shield that lists the fresh result.
  const focusShield = useRef(false)
  const retry = (): void => {
    if (!onRetryVerification || retrying) return
    const on = verification
    setRetrying(true)
    void onRetryVerification(item.id)
      .then(
        () => {
          focusShield.current = footerRef.current?.contains(document.activeElement) ?? false
        },
        () => setRetryFailedOn(on),
      )
      .finally(() => setRetrying(false))
  }
  const musicPrimary = destination === 'appleMusic' || hasMusicCopy
  const musicOffered =
    isMacOS() &&
    !showInMusic &&
    !musicAdded &&
    (musicExt !== 'flac' || hasMusicCopy) &&
    (!inMusicLibraryOnly || hasMusicCopy)
  const lossyToLossless =
    !isMulti &&
    isLosslessContainer(format) &&
    (isLossyContainer(gradedExt(item.inputPath, spectrum?.codec)) ||
      trackQuality({ ...item, spectrum }) === 'transcoded')
  const musicLabel = musicAdding
    ? hasMusicCopy
      ? tr('editor.appleMusicUpdating')
      : tr('editor.appleMusicAdding')
    : musicAdded
      ? tr('editor.appleMusicAdded')
      : hasMusicCopy
        ? tr('editor.appleMusicUpdate')
        : tr('editor.appleMusicAdd')
  // The footer swaps wholesale between the convert button and the done line — the
  // one state change every conversion ends on, and it used to snap. The keyed block
  // below rises in on a real swap only: the editor remounts this footer per track,
  // and stepping through a crate must not replay an entrance on every switch. Refs
  // survive re-renders but not that remount, which is exactly the boundary wanted.
  const prevShowDone = useRef(showDone)
  const running = !!batchRun && !!onCancelBatch
  const prevRunning = useRef(running)
  const swapped = useRef(false)
  const footerRef = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  const heldFocus = useRef(false)
  if (prevShowDone.current !== showDone) {
    swapped.current = true
    prevShowDone.current = showDone
    refocus.current =
      !!footerRef.current?.contains(document.activeElement) ||
      (showDone && heldFocus.current && document.activeElement === document.body)
    heldFocus.current = false
  }
  if (prevRunning.current !== running) {
    prevRunning.current = running
    refocus.current =
      !!footerRef.current?.contains(document.activeElement) ||
      (heldFocus.current && document.activeElement === document.body)
    heldFocus.current = false
  }
  useEffect(() => {
    const footer = footerRef.current
    if (!footer) return
    const held = (): void => {
      heldFocus.current = true
    }
    const lost = (e: FocusEvent): void => {
      if (!(e.target as HTMLElement).matches(':disabled')) heldFocus.current = false
    }
    footer.addEventListener('focusin', held)
    footer.addEventListener('focusout', lost)
    return () => {
      footer.removeEventListener('focusin', held)
      footer.removeEventListener('focusout', lost)
    }
  }, [])
  useLayoutEffect(() => {
    if (focusShield.current && !retrying) {
      focusShield.current = false
      footerRef.current?.querySelector<HTMLButtonElement>('[data-testid="verify-shield"]')?.focus()
    }
    if (!refocus.current) return
    refocus.current = false
    footerRef.current
      ?.querySelector<HTMLButtonElement>(
        '[data-testid="process-btn"], [data-testid="convert-update-anyway"], [data-testid="done-more"], [data-testid="batch-convert"], [data-testid="batch-run-cancel"]',
      )
      ?.focus()
  })
  const batchLine = batch && batchReread && (
    <span className="min-w-0">
      {[
        batch.ok > 0 && (
          <span
            key="verified"
            data-testid="verify-batch-verified"
            data-tone="good"
            className="text-good"
          >
            {`${batchSettled ? '✓ ' : ''}${tr('verify.batch.verified', { count: batch.ok })}`}
          </span>
        ),
        batch.mismatch > 0 && (
          <span
            key="mismatch"
            data-testid="verify-batch-mismatch"
            data-tone="warn"
            className="text-warn"
          >
            {tr('verify.batch.mismatch', { count: batch.mismatch })}
          </span>
        ),
        batch.pending > 0 &&
          tr('verify.batch.pending', { count: batch.pending, programs: pendingPrograms }),
        batch.checking > 0 && tr('verify.batch.checking', { count: batch.checking }),
        batch.unverified > 0 && tr('verify.batch.unverified', { count: batch.unverified }),
      ]
        .filter(Boolean)
        .flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
    </span>
  )
  // Green vouches only for what came back ok: a batch's other counts, a line still pending
  // and a line never re-read are told in the quiet tone.
  const successTone = !isMulti && verification?.status === 'ok' ? 'good' : 'dim'
  const musicLine = MUSIC_LINE[musicOp ?? 'added']
  const addedLine = pendingPrograms
    ? tr(`verify.pendingLine.${musicLine}`, {
        programs: pendingPrograms,
        count: pendingPlaces.length,
      })
    : unverified
      ? tr(`verify.plainLine.${musicLine}`)
      : tr(`editor.${musicLine}`)
  const checkingLine = (
    <p
      data-testid="verify-checking"
      role="status"
      className="flex min-w-0 items-center gap-1.5 text-xs text-fg-dim"
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
      {tr('verify.checking')}
    </p>
  )
  return (
    <div ref={footerRef} className={FOOTER_BAR}>
      {item.status === 'error' && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p role="alert" className="line-clamp-3 min-w-0 text-xs text-danger">
            {item.error && <Tooltip label={item.error} />}
            {item.error}
          </p>
          <button
            type="button"
            data-testid="report-error"
            onClick={() => openFeedback(item.error)}
            className="press shrink-0 text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
          >
            {tr('editor.reportError')}
          </button>
        </div>
      )}
      <div
        key={String(showDone)}
        data-testid="footer-state"
        className={`space-y-2${swapped.current ? ' animate-footer-swap' : ''}`}
      >
        {normalizeCfg.mode !== 'none' && (
          <button
            type="button"
            data-testid="convert-normalize-note"
            onClick={onOpenNormalize}
            className="press group relative flex w-full items-center justify-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
          >
            <SlidersVertical className="h-3 w-3" aria-hidden="true" />
            {tr(`normalize.mode.${normalizeCfg.mode}`)} ·{' '}
            {normalizeCfg.mode === 'loudness'
              ? `${formatUpTo(normalizeCfg.targetLufs, 1, i18n.language)} LUFS`
              : `${formatUpTo(normalizeCfg.peakDb, 1, i18n.language)} dBFS`}
            <Tooltip label={tr('normalize.title')} />
          </button>
        )}
        {batchRun && onCancelBatch ? (
          <BatchRun progress={batchRun} onCancel={onCancelBatch} />
        ) : showDone ? (
          // One line, always, ordered by what matters after an export. On the left, the
          // outcome in words, which is also the way to the library copy; the clean-up of what
          // was left behind, named while the row has room for it and an icon when it doesn't.
          // On the right, the one step still pending (a Music add or update), filled only when
          // Music is the destination or holds a copy, and "•••" for everything else, each named
          // in full in its menu.
          <>
            <div data-testid="done-row" className="@container flex min-w-0 items-center gap-1">
              <div data-testid="done-outcome" className="flex min-w-0 flex-1 items-center gap-1">
                <div className="mr-auto flex min-w-0 items-center gap-0.5">
                  {checking || retrying ? (
                    checkingLine
                  ) : verifyMismatch ? (
                    <p
                      data-testid="verify-mismatch"
                      role="status"
                      className="flex min-w-0 items-center gap-1 text-xs font-medium text-warn"
                    >
                      <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        {worst && retryFailed ? (
                          tr(`verify.detail.${DETAIL_PREFIX[worst.place] ?? worst.place}Unreadable`)
                        ) : verification.originalHeld === 'kept' ? (
                          <Trans
                            i18nKey="verify.heldOriginalLine"
                            values={{ panel: tr('copies.rail') }}
                            components={[
                              <button
                                key="originals"
                                type="button"
                                data-testid="verify-open-originals"
                                onClick={onOpenOriginals}
                                className="underline underline-offset-2 hover:no-underline"
                              />,
                            ]}
                          />
                        ) : verification.originalHeld === 'noRoom' ? (
                          tr('verify.heldOriginalNoRoomLine', { panel: tr('copies.rail') })
                        ) : keptOriginal ? (
                          <Trans
                            i18nKey="verify.sourceGoneKeptLine"
                            values={{ panel: tr('copies.rail') }}
                            components={[
                              <button
                                key="originals"
                                type="button"
                                data-testid="verify-open-originals"
                                onClick={onOpenOriginals}
                                className="underline underline-offset-2 hover:no-underline"
                              />,
                            ]}
                          />
                        ) : (
                          worst && detailText(worst.detail, tr, i18n.language)
                        )}
                      </span>
                    </p>
                  ) : (
                    <p
                      data-testid="export-success"
                      data-tone={successTone}
                      role="status"
                      className={`min-w-0 text-xs font-medium ${successTone === 'good' ? 'text-good' : 'text-fg-dim'} ${
                        pendingPrograms || batchLine ? 'flex items-center gap-1' : 'truncate'
                      }`}
                    >
                      {pendingPrograms && (
                        <Clock
                          data-testid="verify-pending-icon"
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      {batchLine ? (
                        batchLine
                      ) : revealsInMusic && addedToMusic ? (
                        <button
                          type="button"
                          data-testid="add-apple-music"
                          onClick={revealInMusic}
                          aria-label={`${addedLine} · ${tr('editor.appleMusicShow')}`}
                          className="press inline-flex items-center gap-1 text-left hover:underline"
                        >
                          {addedLine}
                          <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </button>
                      ) : addedToMusic ? (
                        isMulti ? (
                          tr(
                            `verify.plainLine.${musicOp ? MUSIC_LINE[musicOp] : 'inAppleMusic'}Count`,
                            { count: selectedCount },
                          )
                        ) : (
                          addedLine
                        )
                      ) : isMulti ? (
                        tr(
                          exportedTagsOnly
                            ? 'verify.plainLine.tagsUpdatedCount'
                            : 'verify.plainLine.exportedCount',
                          { count: selectedCount },
                        )
                      ) : pendingPrograms ? (
                        tr(
                          exportedTagsOnly
                            ? 'verify.pendingLine.tagsUpdated'
                            : 'verify.pendingLine.exportedAs',
                          {
                            format: (exportedFormat ?? '').toUpperCase(),
                            programs: pendingPrograms,
                            count: pendingPlaces.length,
                          },
                        )
                      ) : exportedTagsOnly ? (
                        tr(unverified ? 'verify.plainLine.tagsUpdated' : 'editor.tagsUpdated')
                      ) : (
                        tr(unverified ? 'verify.plainLine.exportedAs' : 'editor.exportedAs', {
                          format: (exportedFormat ?? '').toUpperCase(),
                        })
                      )}
                    </p>
                  )}
                  {(verification?.status === 'ok' ||
                    verification?.status === 'pending' ||
                    verifyMismatch) && <VerifiedPopover checks={verification.checks} />}
                  {canRetry && (
                    <button
                      type="button"
                      data-testid="verify-retry"
                      onClick={retry}
                      aria-disabled={retrying || undefined}
                      className="press flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-xs font-medium text-fg hover:bg-[var(--color-hover)] aria-disabled:opacity-40"
                    >
                      {tr('verify.retry')}
                    </button>
                  )}
                </div>
                {revealsInMusic && !addedToMusic && (
                  <button
                    type="button"
                    data-testid="add-apple-music"
                    onClick={revealInMusic}
                    aria-label={tr('editor.appleMusicShow')}
                    className={`${ICON_BUTTON} hover:text-fg`}
                  >
                    <Music className="h-3.5 w-3.5" aria-hidden="true" />
                    <Tooltip label={tr('editor.appleMusicShow')} />
                  </button>
                )}
                {revealIn.map((source) => {
                  const Icon = SOURCE_ICON[source]
                  const label = tr('editor.showInLibrary', { app: tr(`sources.${source}`) })
                  return (
                    <button
                      key={source}
                      type="button"
                      data-testid={`reveal-in-${source}`}
                      onClick={() => onRevealIn?.(source)}
                      aria-label={label}
                      className={`${ICON_BUTTON} hover:text-fg`}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <Tooltip label={label} />
                    </button>
                  )
                })}
                {cleanupFiles > 0 && (
                  <button
                    type="button"
                    data-testid="clean-up-previous"
                    onClick={() => onCleanUp?.(cleanup)}
                    aria-label={tr('editor.cleanUpPrevious', { count: cleanupFiles })}
                    className="press relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-fg-dim hover:bg-[var(--color-hover)] hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span className="hidden whitespace-nowrap @min-[34rem]:inline">
                      {tr('editor.cleanUpPrevious', { count: cleanupFiles })}
                    </span>
                    <Tooltip label={tr('editor.cleanUpPrevious', { count: cleanupFiles })} />
                  </button>
                )}
              </div>
              {cleanupFiles > 0 && (
                <span
                  data-testid="done-divider"
                  aria-hidden="true"
                  className="mx-1 h-4 w-px shrink-0 bg-[var(--color-line-strong)]"
                />
              )}
              <div data-testid="done-actions" className="flex shrink-0 items-center gap-2">
                {musicOffered && musicPrimary && (
                  <button
                    type="button"
                    data-testid="add-apple-music"
                    data-variant={musicPrimary ? 'primary' : 'secondary'}
                    onClick={onAddToAppleMusic}
                    disabled={musicAdding}
                    className={`press flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-xs font-medium disabled:opacity-40 ${
                      musicPrimary
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
                        : 'border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-line-strong)]'
                    }`}
                  >
                    {musicLabel}
                  </button>
                )}
                <DoneMenu
                  multi={isMulti}
                  outputFormat={format}
                  exportedFormat={isMulti ? null : exportedFormat}
                  inPlace={!isMulti && willEditInPlace}
                  tagsOnly={!isMulti && tagsOnly}
                  incomplete={incomplete}
                  incompleteReason={incompleteReason}
                  destination={destination}
                  destinations={destinations}
                  revealPath={addedToMusic ? null : revealPath}
                  music={
                    musicOffered && !musicPrimary && onAddToAppleMusic
                      ? { label: musicLabel, busy: musicAdding, onAdd: onAddToAppleMusic }
                      : undefined
                  }
                  onProcess={onProcess}
                  onSelectFormat={onSelectFormat}
                  onSelectDestination={onSelectDestination}
                  onExportCollection={onExportCollection}
                />
              </div>
            </div>
            {musicError && (
              <p role="alert" className="text-xs text-danger">
                {musicError}
              </p>
            )}
          </>
        ) : (
          <>
            {!isMulti && spectrum?.damaged && (
              <p data-testid="convert-damaged-note" className="text-center text-xs text-fg-dim">
                {tr('editor.damagedSource')}
              </p>
            )}
            {lossyToLossless && (
              <p data-testid="convert-lossy-note" className="text-center text-xs text-fg-dim">
                {tr('editor.lossyToLossless', { format: format.toUpperCase() })}
              </p>
            )}
            {checking ? (
              <div className="flex h-10 items-center justify-center">{checkingLine}</div>
            ) : isMulti ? (
              <BatchPlan
                count={readyCount ?? selectedCount}
                total={selectedCount}
                onConvert={onConvertSelection}
                format={format}
                destination={destination}
                destinations={destinations}
                leftOut={leftOut}
                onBlockedPress={onBlockedPress}
                onSelectFormat={onSelectFormat}
                onSelectDestination={onSelectDestination}
              />
            ) : (
              <ExportButton
                status={isMulti ? 'idle' : item.status}
                stage={isMulti ? undefined : item.stage}
                stale={!isMulti && stale}
                replaces={!isMulti && replaces}
                libraryBetter={!isMulti && libraryBetter}
                done={!isMulti && done}
                outputFormat={format}
                exportedFormat={isMulti ? null : exportedFormat}
                incomplete={incomplete}
                incompleteReason={incompleteReason}
                blockedLabel={incompleteSummary}
                onBlockedPress={onBlockedPress}
                inPlace={!isMulti && willEditInPlace}
                tagsOnly={tagsOnly}
                sameFormat={sameFormat}
                upToDate={upToDate}
                destination={destination}
                destinations={destinations}
                count={isMulti ? selectedCount : undefined}
                onProcess={onProcess}
                onCancel={onCancel}
                onSelectFormat={onSelectFormat}
                onSelectDestination={onSelectDestination}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
