import { ArrowUpRight, Music, SlidersVertical, Trash2 } from 'lucide-react'
import type React from 'react'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FormatSetting,
  NormalizeConfig,
  OutputFormat,
  PlaylistSource,
} from '../../../shared/types'
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
import { DoneMenu } from './DoneMenu'
import { ExportButton } from './ExportButton'
import { SOURCE_ICON } from './SourceRail'
import { FOOTER_BAR } from './SplitButton'
import { Tooltip } from './Tooltip'

const ICON_BUTTON =
  'press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-dim hover:bg-[var(--color-hover)]'

interface ConvertFooterProps {
  item: TrackItem
  isMulti: boolean
  // Size of the multi-selection, for the "Convert all (N)" label and the done counts.
  selectedCount: number
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
  onBlockedPress?: () => void
  willEditInPlace: boolean
  tagsOnly: boolean
  addToAppleMusic: boolean
  addToEngineDj: boolean
  // The editor's one-shot destination pick and the choices its split-button menu
  // offers, pre-filtered by the editor (platform, configured overwrite).
  destination: Destination
  destinations: readonly Destination[]
  outputFolder: string
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
  // it runs. Undefined in multi, where the toolbar batch pill owns the cancel.
  onCancel?: () => void
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
}

// The editor's bottom bar: the error row, the normalization note, and either the
// convert split-button or — once everything selected is done — the outcome with its
// inline links (reveal/clean up) beside the next steps (Apple Music, DJ app, re-export).
export function ConvertFooter({
  item,
  isMulti,
  selectedCount,
  status,
  stale,
  replaces,
  libraryBetter,
  done,
  incomplete,
  incompleteReason,
  incompleteSummary,
  onBlockedPress,
  willEditInPlace,
  tagsOnly,
  addToAppleMusic,
  addToEngineDj,
  destination,
  destinations,
  outputFolder,
  format,
  exportedFormat,
  musicExt,
  normalizeCfg,
  onOpenNormalize,
  onSelectFormat,
  onSelectDestination,
  onProcess,
  onCancel,
  onAddToAppleMusic,
  staleMusicCopy,
  supersededPath,
  onCleanUp,
  onExportCollection,
  revealIn = [],
  onRevealIn,
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
    staleMusicCopy: !isMulti && musicAdded && staleMusicCopy ? staleMusicCopy : null,
  }
  const cleanupFiles = cleanupCount(cleanup)
  const musicPrimary = destination === 'appleMusic' || hasMusicCopy
  const lossyToLossless =
    !isMulti &&
    isLosslessContainer(format) &&
    (isLossyContainer(gradedExt(item.inputPath, item.spectrum?.codec)) ||
      trackQuality(item) === 'transcoded')
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
  const swapped = useRef(false)
  const footerRef = useRef<HTMLDivElement>(null)
  // The swap unmounts the button a keyboard user just pressed and focus drops to <body>.
  // Whether focus was in here is read before the commit replaces the block, while the old
  // button still holds it, so only focus the footer itself owned is handed back.
  const refocus = useRef(false)
  if (prevShowDone.current !== showDone) {
    swapped.current = true
    prevShowDone.current = showDone
    refocus.current = footerRef.current?.contains(document.activeElement) ?? false
  }
  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    footerRef.current
      ?.querySelector<HTMLButtonElement>('[data-testid="process-btn"], [data-testid="done-more"]')
      ?.focus()
  })
  return (
    <div ref={footerRef} className={FOOTER_BAR}>
      {item.status === 'error' && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p role="alert" title={item.error} className="line-clamp-3 min-w-0 text-xs text-danger">
            {item.error}
          </p>
          <button
            type="button"
            data-testid="report-error"
            onClick={() => openFeedback(item.error)}
            className="shrink-0 text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
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
            <SlidersVertical className="h-3.5 w-3.5" aria-hidden="true" />
            {tr(`normalize.mode.${normalizeCfg.mode}`)} ·{' '}
            {normalizeCfg.mode === 'loudness'
              ? `${formatUpTo(normalizeCfg.targetLufs, 1, i18n.language)} LUFS`
              : `${formatUpTo(normalizeCfg.peakDb, 1, i18n.language)} dBFS`}
            <Tooltip label={tr('normalize.title')} />
          </button>
        )}
        {showDone ? (
          // One line, always, ordered by what matters after an export. On the left, the
          // outcome in words, which is also the way to the library copy; the clean-up of what
          // was left behind, named while the row has room for it and an icon when it doesn't.
          // On the right, the one step still pending (a Music add or update), filled only when
          // Music is the destination or holds a copy, and "•••" for everything else, each named
          // in full in its menu.
          <>
            <div data-testid="done-row" className="@container flex min-w-0 items-center gap-1">
              <div data-testid="done-outcome" className="flex min-w-0 flex-1 items-center gap-1">
                <p
                  data-testid="export-success"
                  role="status"
                  className="mr-auto min-w-0 truncate text-xs font-medium text-good"
                >
                  {revealsInMusic && addedToMusic ? (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      onClick={revealInMusic}
                      aria-label={`${tr('editor.addedToAppleMusic')} · ${tr('editor.appleMusicShow')}`}
                      className="press inline-flex items-center gap-1 hover:underline"
                    >
                      {tr('editor.addedToAppleMusic')}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : addedToMusic ? (
                    isMulti ? (
                      tr('editor.addedToAppleMusicCount', { count: selectedCount })
                    ) : (
                      tr('editor.addedToAppleMusic')
                    )
                  ) : isMulti ? (
                    tr('editor.exportedCount', { count: selectedCount })
                  ) : (
                    tr('editor.exportedAs', { format: (exportedFormat ?? '').toUpperCase() })
                  )}
                </p>
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
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
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
                {isMacOS() &&
                  !showInMusic &&
                  !musicAdded &&
                  (musicExt !== 'flac' || hasMusicCopy) &&
                  (!inMusicLibraryOnly || hasMusicCopy) && (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      data-variant={musicPrimary ? 'primary' : 'secondary'}
                      onClick={onAddToAppleMusic}
                      disabled={musicAdding}
                      className={`press flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-xs font-medium disabled:opacity-60 ${
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
                  incomplete={incomplete}
                  incompleteReason={incompleteReason}
                  destination={destination}
                  destinations={destinations}
                  revealPath={addedToMusic ? null : revealPath}
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
            {lossyToLossless && (
              <p data-testid="convert-lossy-note" className="text-center text-xs text-fg-dim">
                {tr('editor.lossyToLossless', { format: format.toUpperCase() })}
              </p>
            )}
            <ExportButton
              status={isMulti ? 'idle' : item.status}
              stage={isMulti ? undefined : item.stage}
              stale={!isMulti && stale}
              replaces={!isMulti && replaces}
              libraryBetter={!isMulti && libraryBetter}
              done={!isMulti && done}
              outputFormat={format}
              exportedFormat={isMulti ? null : exportedFormat}
              withAppleMusic={isMacOS() && format !== 'flac' && addToAppleMusic}
              withEngineDj={addToEngineDj}
              incomplete={incomplete}
              incompleteReason={incompleteReason}
              blockedLabel={incompleteSummary}
              onBlockedPress={onBlockedPress}
              inPlace={!isMulti && willEditInPlace}
              tagsOnly={tagsOnly}
              inMusic={hasMusicCopy}
              destination={destination}
              destinations={destinations}
              outputFolder={outputFolder}
              count={isMulti ? selectedCount : undefined}
              onProcess={onProcess}
              onCancel={onCancel}
              onSelectFormat={onSelectFormat}
              onSelectDestination={onSelectDestination}
            />
          </>
        )}
      </div>
    </div>
  )
}
